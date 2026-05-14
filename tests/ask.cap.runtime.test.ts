import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryModule, RuntimeModule } from "../src/agent/index.ts";
import { BlackboardModule, SQLiteBlackboardStore } from "../src/agent/blackboard/index.ts";
import { WorkerManager } from "../src/agent/worker/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    AskReason,
    BlackboardTurnStatus,
    Channel,
    ChatType,
    type AgentAsk,
    type GatewayMessage,
    type ModelClient,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import { resolve } from "node:path";
import { mkdir, symlink } from "node:fs/promises";

const tempRoots: string[] = [];
const cleanup = async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
};

class CapturingSink implements EventSink {
    readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(evt);
    }
}

async function tempRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-stalemate-"));
    tempRoots.push(d);
    return d;
}

function paths(root: string): FlyflorPaths {
    const home = join(root, "home");
    const project = join(root, "project");
    return {
        home,
        configDir: home,
        storageDir: join(home, "storage"),
        cacheDir: join(home, "cache"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(home, "memory"),
        journalDir: join(home, "journal"),
        projectMemoryDir: join(home, "memory", "projects"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
        projectDir: project,
        projectFlyflorDir: join(project, ".flyflor"),
        projectSkillDir: join(project, ".flyflor", "skills"),
        projectMcpDir: join(project, ".flyflor", "mcp"),
        projectPluginDir: join(project, ".flyflor", "plugins"),
    };
}

async function makeConfig(): Promise<FlyflorConfig> {
    const root = await tempRoot();
    const p = paths(root);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(join(p.home), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), p.promptDir, "dir");
    await symlink(join(repoRoot, "templates"), p.templateDir, "dir");
    return await loadConfigForPaths(p);
}

function gwMsg(text: string, msgId = `m-${Math.random().toString(36).slice(2, 8)}`): GatewayMessage {
    return {
        id: msgId,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "user-cap", displayName: "User" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-cap" },
    };
}
function ctx(): RuntimeContext {
    return { requestId: `req-${Math.random().toString(36).slice(2, 8)}`, now: new Date().toISOString(), embedding: [] };
}

/** 模型一直坚持发 ask，让 runtime 验证 cap 强制 reply 行为。 */
class AskingModel implements ModelClient {
    readonly id = "test-asking";
    constructor(private readonly askPrompt: string) {}
    async generate(): Promise<string> {
        return [
            "Sure, but first I need clarification.",
            "<flyflor_agent_ask>",
            JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: this.askPrompt }),
            "</flyflor_agent_ask>",
        ].join("\n");
    }
}

class MultiQuestionModel implements ModelClient {
    async generate(): Promise<string> {
        return [
            "Need to confirm a few details.",
            "<flyflor_agent_ask>",
            JSON.stringify({
                reason: AskReason.UserIntentUnclear,
                prompt: "I need two confirmations.",
                questions: [
                    {
                        prompt: "Which workspace should I use?",
                        choices: [
                            { label: "main", value: "main" },
                            { label: "scratch", value: "scratch" },
                        ],
                    },
                    {
                        prompt: "Should I proceed now?",
                        freeform: false,
                        choices: [
                            { label: "yes", value: "yes" },
                            { label: "no", value: "no" },
                        ],
                    },
                ],
            }),
            "</flyflor_agent_ask>",
        ].join("\n");
    }
}

describe("LF-R3 slice D — runtime cap enforcement", () => {
    test("model-emitted ask is dropped when chainDepth would exceed maxChainDepth", async () => {
        try {
            const config = await makeConfig();
            config.memory.tuning.ghost.maxChainDepth = 2;
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                // Seed two pending asks at chainDepth 1, 2 directly via memory.
                const askA: AgentAsk = { reason: AskReason.UserIntentUnclear, prompt: "first?", freeform: true };
                const askB: AgentAsk = { reason: AskReason.UserIntentUnclear, prompt: "second?", freeform: true };
                await memory.rememberTurn(gwMsg("hi", "m-1"), { messageId: "m-1", route: gwMsg("x").route, text: "first?" }, ctx(), [], {}, askA);
                await memory.rememberTurn(gwMsg("yes", "m-2"), { messageId: "m-2", route: gwMsg("x").route, text: "second?" }, ctx(), [], {}, askB);

                const peek = memory.peekActiveAsk("user-cap");
                expect(peek?.chainDepth).toBe(2);

                const workers = new WorkerManager(events);
                const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
                const runtime = new RuntimeModule(config, new AskingModel("third?"), events, blackboard, memory);
                const reply = await runtime.handleMessage(gwMsg("user follow-up", "m-3"), ctx());

                // chainDepth+1 = 3 > cap 2 → ask 被抛弃，走 reply 通道。
                expect(reply.metadata?.kind).toBe("reply");
                expect(events.events.some(
                    (e) =>
                        e.type === RuntimeEventType.MemoryAskChainCapped &&
                        e.payload?.action === "dropped-by-runtime",
                )).toBe(true);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("multi-question ask renders numbered sub-questions and metadata counts them", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const runtime = new RuntimeModule(config, new MultiQuestionModel(), events, undefined, memory);
                const reply = await runtime.handleMessage(gwMsg("need guidance", "m-10"), ctx());
                expect(reply.metadata?.kind).toBe("ask");
                expect(reply.metadata?.behaviorSnapshotId).toMatch(/^behavior-/);
                expect(reply.metadata?.ask).toMatchObject({
                    choiceCount: 0,
                    questionCount: 2,
                    snapshotId: reply.metadata?.behaviorSnapshotId,
                });
                expect(reply.text).toContain("I need two confirmations.");
                expect(reply.text).toContain("1. Which workspace should I use?");
                expect(reply.text).toContain("   1. main");
                expect(reply.text).toContain("   3. Other — type your own answer");
                expect(reply.text).toContain("2. Should I proceed now?");
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });
});

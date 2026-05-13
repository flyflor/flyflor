import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MemoryModule, RuntimeModule } from "../src/agent/index.ts";
import { BlackboardModule, SQLiteBlackboardStore } from "../src/agent/blackboard/index.ts";
import { WorkerManager } from "../src/agent/worker/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    AskReason,
    Channel,
    ChatType,
    EqLabel,
    type GatewayMessage,
    type ModelClient,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

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
    const d = await mkdtemp(join(tmpdir(), "flyflor-eq03-"));
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
    await mkdir(p.home, { recursive: true });
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
        user: { id: "user-eq03", displayName: "User" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-eq03" },
    };
}

function ctx(): RuntimeContext {
    return { requestId: `req-${Math.random().toString(36).slice(2, 8)}`, now: new Date().toISOString(), embedding: [] };
}

class AskingModel implements ModelClient {
    readonly id = "test-eq03";
    constructor(private readonly askPrompt: string) {}
    async generate(): Promise<string> {
        return [
            "I need clarification.",
            "<flyflor_agent_ask>",
            JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: this.askPrompt }),
            "</flyflor_agent_ask>",
        ].join("\n");
    }
}

describe("EQ-03 — runtime ask cap dynamic override under CalmDown directive", () => {
    test("CalmDown 状态下，cap 临时降为 1：已存在 pending ask 时新 ask 被 runtime 抛弃", async () => {
        try {
            const config = await makeConfig();
            // baseline cap = 5（足以让常规 chain 走过去），由 CalmDown 临时压到 1
            config.memory.tuning.ghost.maxChainDepth = 5;
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                // 一次 rememberTurn 同时写入 ask + EQ（CalmDown 触发条件）
                const askA = { reason: AskReason.UserIntentUnclear, prompt: "first?", freeform: true } as const;
                await memory.rememberTurn(
                    gwMsg("hi", "m-1"),
                    { messageId: "m-1", route: gwMsg("x").route, text: "first?" },
                    ctx(),
                    [
                        {
                            action: "add",
                            target: "memory",
                            content: "carrier",
                            eq: {
                                label: EqLabel.Anger,
                                valence: -0.7,
                                arousal: 0.8,
                                dominance: 0.5,
                                confidence: 0.9,
                            },
                        },
                    ],
                    {},
                    askA,
                );
                expect(memory.peekActiveAsk("user-eq03")?.chainDepth).toBe(1);

                const workers = new WorkerManager(events);
                const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
                const runtime = new RuntimeModule(config, new AskingModel("second?"), events, blackboard, memory);

                events.events.length = 0;
                const reply = await runtime.handleMessage(gwMsg("user follow-up", "m-2"), ctx());

                // baseline cap=5 本应允许 chainDepth=2 通过；但 CalmDown 把 effective cap 压到 1
                // → projectedDepth=2 > 1 → ask 被 runtime 抛弃，走 reply
                expect(reply.metadata?.kind).toBe("reply");
                const directiveEvent = events.events.find(
                    (e) => e.type === RuntimeEventType.RuntimeEqDirectiveApplied,
                );
                expect(directiveEvent).toBeTruthy();
                expect(directiveEvent!.payload?.directive).toBe("calm-down");
                expect(directiveEvent!.payload?.action).toBe("ask-cap-overridden");
                expect(directiveEvent!.payload?.baseCap).toBe(5);
                expect(directiveEvent!.payload?.effectiveCap).toBe(1);

                const cappedEvent = events.events.find(
                    (e) =>
                        e.type === RuntimeEventType.MemoryAskChainCapped &&
                        e.payload?.reason === "eq-calm-down",
                );
                expect(cappedEvent).toBeTruthy();
                expect(cappedEvent!.payload?.maxChainDepth).toBe(1);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("非 CalmDown（neutral / steady）时不覆盖 cap，也不发 RuntimeEqDirectiveApplied", async () => {
        try {
            const config = await makeConfig();
            config.memory.tuning.ghost.maxChainDepth = 5;
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const askA = { reason: AskReason.UserIntentUnclear, prompt: "first?", freeform: true } as const;
                await memory.rememberTurn(
                    gwMsg("hi", "m-1"),
                    { messageId: "m-1", route: gwMsg("x").route, text: "first?" },
                    ctx(),
                    [
                        {
                            action: "add",
                            target: "memory",
                            content: "carrier",
                            eq: {
                                label: EqLabel.Neutral,
                                valence: 0.05,
                                arousal: 0.05,
                                dominance: 0.5,
                                confidence: 0.9,
                            },
                        },
                    ],
                    {},
                    askA,
                );
                const workers = new WorkerManager(events);
                const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
                const runtime = new RuntimeModule(config, new AskingModel("second?"), events, blackboard, memory);
                events.events.length = 0;
                const reply = await runtime.handleMessage(gwMsg("user follow-up", "m-2"), ctx());

                // baseline cap=5；Steady 不覆盖；projectedDepth=2 < 5 → ask 通过
                expect(reply.metadata?.kind).toBe("ask");
                expect(
                    events.events.some((e) => e.type === RuntimeEventType.RuntimeEqDirectiveApplied),
                ).toBe(false);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });
});

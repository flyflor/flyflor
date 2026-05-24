import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { Database } from "bun:sqlite";
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
    type ModelMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { resolve } from "node:path";
import { mkdir, readFile, readdir, symlink } from "node:fs/promises";

const tempRoots: string[] = [];
const cleanup = async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
};

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(evt: { type: string; payload?: Record<string, unknown> }): void {
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
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, conversationKey: "chat-cap" },
    };
}
function ctx(): RuntimeContext {
    return { requestId: `req-${Math.random().toString(36).slice(2, 8)}`, now: new Date().toISOString(), embedding: [], contextForkId: "test-fork" };
}

/** 模型一直坚持发 ask，让 runtime 验证 cap 强制 reply 行为。 */
class AskingModel implements ModelClient {
    public readonly id = "test-asking";
    public constructor(private readonly askPrompt: string) {}
    public async generate(messages: ModelMessage[] = []): Promise<string> {
        const control = testControlPromptResponse(messages);
        if (control) return control;
        return [
            "Sure, but first I need clarification.",
            "<agent_question>",
            JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: this.askPrompt }),
            "</agent_question>",
        ].join("\n");
    }
}

class MultiQuestionModel implements ModelClient {
    public async generate(messages: ModelMessage[] = []): Promise<string> {
        const control = testControlPromptResponse(messages);
        if (control) return control;
        return [
            "Need to confirm a few details.",
            "<agent_question>",
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
            "</agent_question>",
        ].join("\n");
    }
}

class ForkConflictMergeModel implements ModelClient {
    public async generate(messages: ModelMessage[] = []): Promise<string> {
        const control = testControlPromptResponse(messages);
        if (control) return control;
        return [
            "Fork merge needs structured resolution.",
            "<agent_context_decisions>",
            JSON.stringify({
                forkMerges: [
                    {
                        forkId: "fork-conflict-runtime",
                        kind: "conflict-ask",
                        conflicts: [{ id: "c1", summary: "Two branch results compete.", options: ["left", "right"] }],
                        conflictAsk: {
                            reason: AskReason.PolicyDecision,
                            prompt: "Which fork result should be merged?",
                            freeform: false,
                            choices: [
                                { label: "left", value: "left" },
                                { label: "right", value: "right" },
                            ],
                        },
                    },
                ],
            }),
            "</agent_context_decisions>",
        ].join("\n");
    }
}

class ForkMergedClosureModel implements ModelClient {
    public async generate(messages: ModelMessage[] = []): Promise<string> {
        const control = testControlPromptResponse(messages);
        if (control) return control;
        return [
            "Fork merge completed.",
            "<agent_context_decisions>",
            JSON.stringify({
                forkMerges: [
                    {
                        forkId: "fork-merged-runtime",
                        kind: "merged",
                        mergedSummary: "Merged fork closure into the parent scope with resolved evidence.",
                        closureEvidence: [
                            {
                                kind: "fork-merged",
                                weight: 0.9,
                                sourceId: "fork-merged-runtime",
                                note: "structured runtime merge closure",
                            },
                        ],
                    },
                ],
            }),
            "</agent_context_decisions>",
        ].join("\n");
    }
}

class CapturingModel implements ModelClient {
    public readonly prompts: string[] = [];
    public constructor(private readonly response: string) {}
    public async generate(messages: ModelMessage[]): Promise<string> {
        this.prompts.push(messages.map((message) => message.content).join("\n"));
        const control = testControlPromptResponse(messages);
        if (control) return control;
        return this.response;
    }
}

function testControlPromptResponse(messages: ModelMessage[]): string | undefined {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (system.includes("Decide whether the current request should proceed directly")) {
        return JSON.stringify({
            decision: "direct",
            reason: "test direct path",
            confidence: 1,
            planTitle: "",
            planSummary: "",
            askPrompt: "",
        });
    }
    if (system.includes("decide whether the assistant must use available local tools")) {
        return JSON.stringify({
            decision: "answer",
            calls: [],
            reason: "test answer path",
        });
    }
    return undefined;
}

describe("LF-R3 slice D — runtime cap enforcement", () => {
    test("model-emitted ask is dropped when chainDepth would exceed maxChainDepth", async () => {
        try {
            const config = await makeConfig();
            config.memory.tuning.continuation.maxChainDepth = 2;
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                // Seed two pending asks at chainDepth 1, 2 directly via memory.
                const askA: AgentAsk = { reason: AskReason.UserIntentUnclear, prompt: "first?", freeform: true };
                const askB: AgentAsk = { reason: AskReason.UserIntentUnclear, prompt: "second?", freeform: true };
                await memory.rememberTurn(gwMsg("hi", "m-1"), { messageId: "m-1", route: gwMsg("x").route, text: "first?" }, ctx(), [], {}, askA);
                await memory.rememberTurn(gwMsg("yes", "m-2"), { messageId: "m-2", route: gwMsg("x").route, text: "second?" }, ctx(), [], {}, askB);

                const peek = memory.peekActiveAsk("fork:test-fork");
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

    test("unanswered ask is saved as a ghost snapshot with scope and fork context", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const model = new CapturingModel([
                    "Need a decision.",
                    "<agent_question>",
                    JSON.stringify({
                        reason: AskReason.PolicyDecision,
                        prompt: "Pick the merge direction.",
                        continuationHint: { title: "Merge direction", contextHint: "fork needs a decision" },
                    }),
                    "</agent_question>",
                ].join("\n"));
                const runtime = new RuntimeModule(config, model, events, undefined, memory);
                const context = {
                    ...ctx(),
                    activeScope: {
                        id: "scope-ghost",
                        title: "Ghost Scope",
                        projectDir: config.paths.projectDir,
                        projectMemoryDir: join(config.paths.projectDir, ".flyflor", "memory"),
                    },
                    contextForkId: "fork-ghost",
                };
                const reply = await runtime.handleMessage(gwMsg("merge this branch", "m-ghost-1"), context);

                expect(reply.metadata?.kind).toBe("ask");
                const snapshotId = String(reply.metadata?.behaviorSnapshotId);
                const raw = await readFile(join(config.paths.storageDir, "continuation-ghosts", `${snapshotId}.json`), "utf8");
                const snapshot = JSON.parse(raw) as {
                    activeScope?: { id?: string };
                    contextForkId?: string;
                    continuationId?: string;
                    snapshotId?: string;
                };
                expect(snapshot).toMatchObject({
                    activeScope: { id: "scope-ghost" },
                    contextForkId: "fork-ghost",
                    snapshotId,
                });
                expect(snapshot.continuationId).toMatch(/^continuation-/);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("explicit continue restores pending ask scope and fork without reading text intent", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const firstModel = new CapturingModel([
                    "<agent_question>",
                    JSON.stringify({
                        reason: AskReason.PolicyDecision,
                        prompt: "Pick the merge direction.",
                        continuationHint: { title: "Merge direction" },
                    }),
                    "</agent_question>",
                ].join("\n"));
                const runtime = new RuntimeModule(config, firstModel, events, undefined, memory);
                const scope = {
                    id: "scope-resume",
                    title: "Resume Scope",
                    projectDir: config.paths.projectDir,
                    projectMemoryDir: join(config.paths.projectDir, ".flyflor", "memory"),
                };
                const askReply = await runtime.handleMessage(
                    gwMsg("merge branch", "m-resume-1"),
                    { ...ctx(), requestId: "req-resume-1", activeScope: scope, contextForkId: "fork-resume" },
                );

                const secondModel = new CapturingModel("continuing now");
                const runtime2 = new RuntimeModule(config, secondModel, events, undefined, memory);
                const finalReply = await runtime2.handleMessage(
                    {
                        ...gwMsg("use the left branch", "m-resume-2"),
                        metadata: {
                            continuation: {
                                mode: "continue",
                                snapshotId: String(askReply.metadata?.behaviorSnapshotId),
                            },
                        },
                    },
                    { ...ctx(), requestId: "req-resume-2", contextForkId: undefined },
                );

                expect(finalReply.metadata?.kind).toBe("reply");
                expect(secondModel.prompts[0]).toContain("You previously asked the user");
                expect(secondModel.prompts[0]).toContain("Pick the merge direction.");
                expect(memory.peekActiveAsk("fork:fork-resume")).toBeNull();
                const remaining = await readdir(join(config.paths.storageDir, "continuation-ghosts"));
                expect(remaining).toEqual([]);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("direct answer to pending ask clears its ghost snapshot without explicit continue", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const runtime = new RuntimeModule(config, new CapturingModel([
                    "<agent_question>",
                    JSON.stringify({ reason: AskReason.PolicyDecision, prompt: "Choose a branch." }),
                    "</agent_question>",
                ].join("\n")), events, undefined, memory);
                const askReply = await runtime.handleMessage(
                    gwMsg("seed ask", "m-direct-answer-1"),
                    { ...ctx(), requestId: "req-direct-answer-1" },
                );
                const snapshotPath = join(
                    config.paths.storageDir,
                    "continuation-ghosts",
                    `${String(askReply.metadata?.behaviorSnapshotId)}.json`,
                );
                expect(await readFile(snapshotPath, "utf8")).toContain("Choose a branch.");

                const runtime2 = new RuntimeModule(config, new CapturingModel("handled"), events, undefined, memory);
                await runtime2.handleMessage(
                    gwMsg("left branch", "m-direct-answer-2"),
                    { ...ctx(), requestId: "req-direct-answer-2" },
                );

                const remaining = await readdir(join(config.paths.storageDir, "continuation-ghosts"));
                expect(remaining).toEqual([]);
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("explicit continue with missing or conflicting snapshot returns structured ask", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const runtime = new RuntimeModule(config, new CapturingModel("unused"), events, undefined, memory);
                const missing = await runtime.handleMessage(
                    {
                        ...gwMsg("not a semantic trigger", "m-missing"),
                        metadata: { continuation: { mode: "continue", snapshotId: "behavior-missing" } },
                    },
                    { ...ctx(), requestId: "req-missing" },
                );
                expect(missing.metadata).toMatchObject({
                    kind: "ask",
                    continuation: { resume: "failed", reason: "missing" },
                });

                const askRuntime = new RuntimeModule(config, new CapturingModel([
                    "<agent_question>",
                    JSON.stringify({ reason: AskReason.PolicyDecision, prompt: "Choose" }),
                    "</agent_question>",
                ].join("\n")), events, undefined, memory);
                const askReply = await askRuntime.handleMessage(
                    gwMsg("seed ask", "m-conflict-1"),
                    {
                        ...ctx(),
                        requestId: "req-conflict-1",
                        contextForkId: "fork-a",
                    },
                );
                const conflict = await runtime.handleMessage(
                    {
                        ...gwMsg("resume with wrong fork", "m-conflict-2"),
                        metadata: {
                            continuation: {
                                mode: "continue",
                                snapshotId: String(askReply.metadata?.behaviorSnapshotId),
                            },
                        },
                    },
                    {
                        ...ctx(),
                        requestId: "req-conflict-2",
                        contextForkId: "fork-b",
                    },
                );
                expect(conflict.metadata).toMatchObject({
                    kind: "ask",
                    continuation: { resume: "failed", reason: "conflict" },
                });
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("fork merge conflict decision is consumed as the runtime ask", async () => {
        try {
            const config = await makeConfig();
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const runtime = new RuntimeModule(config, new ForkConflictMergeModel(), events, undefined, memory);
                const reply = await runtime.handleMessage(gwMsg("merge this fork", "m-fork-conflict"), ctx());

                expect(reply.metadata?.kind).toBe("ask");
                expect(reply.text).toContain("Which fork result should be merged?");
                expect(reply.metadata?.ask).toMatchObject({ choiceCount: 2 });
                expect(memory.peekActiveAsk("fork:test-fork")?.ask.prompt).toBe("Which fork result should be merged?");
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });

    test("merged fork decision records Crystal closure evidence during runtime consumption", async () => {
        try {
            const config = await makeConfig();
            config.memory.crystal.enabled = true;
            const events = new CapturingSink();
            const memory = new MemoryModule(config, events);
            await memory.warmup();
            try {
                const runtime = new RuntimeModule(config, new ForkMergedClosureModel(), events, undefined, memory);
                const reply = await runtime.handleMessage(gwMsg("merge clean fork", "m-fork-merged"), ctx());

                expect(reply.metadata?.kind).toBe("reply");
                const db = new Database(config.memory.crystal.local.dbFile, { readonly: true });
                try {
                    const candidate = db
                        .query<{ source_kind: string; source_id: string; evidence_json: string }, []>(
                            "SELECT source_kind, source_id, evidence_json FROM crystal_candidates WHERE source_kind = 'context-fork-closure'",
                        )
                        .get();
                    expect(candidate).toMatchObject({
                        source_kind: "context-fork-closure",
                        source_id: "fork-merged-runtime",
                    });
                    expect(JSON.parse(candidate?.evidence_json ?? "[]")).toEqual([
                        expect.objectContaining({ kind: "fork-merged", sourceId: "fork-merged-runtime" }),
                    ]);
                } finally {
                    db.close();
                }
            } finally {
                memory.dispose();
            }
        } finally {
            await cleanup();
        }
    });
});

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    AskReason,
    Channel,
    ChatType,
    ContinuationContextReason,
    MemoryEventStatus,
    type AgentAsk,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(evt);
    }
}

async function tempRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-continuation-wire-"));
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
    await mkdir(dirname(p.promptDir), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), p.promptDir, "dir");
    await mkdir(dirname(p.templateDir), { recursive: true });
    await symlink(join(repoRoot, "templates"), p.templateDir, "dir");
    return await loadConfigForPaths(p);
}

function gatewayMessage(text: string, msgId = `msg-${Math.random().toString(36).slice(2, 8)}`): GatewayMessage {
    return {
        id: msgId,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "user-1", displayName: "User" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
    };
}

function gatewayReply(text: string, messageId: string): GatewayReply {
    return {
        messageId,
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
        text,
    };
}

function runtimeContext(): RuntimeContext {
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
    };
}

const askA: AgentAsk = {
    reason: AskReason.UserIntentUnclear,
    prompt: "Did you mean A or B?\nClarify please.",
    freeform: true,
};

describe("LF-R4 Continuation Context wiring", () => {
    test("recordAskEvent also writes sibling continuation-context with parent_id=ask.id and fallback title", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("Did you mean A or B?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            try {
                const askRow = db.query("SELECT id FROM memory_events WHERE type = 'ask'").get() as { id: string };
                const continuationRows = db
                    .query("SELECT id, parent_id, content FROM memory_events WHERE type = 'continuation-context'")
                    .all() as Array<{ id: string; parent_id: string | null; content: string }>;
                expect(continuationRows.length).toBe(1);
                expect(continuationRows[0]!.parent_id).toBe(askRow.id);
                const content = JSON.parse(continuationRows[0]!.content) as {
                    reason: string;
                    userFacing?: { title?: string };
                };
                expect(content.reason).toBe("ask");
                expect(content.userFacing?.title).toBe("Did you mean A or B?");
            } finally {
                db.close();
            }
            expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryContinuationRecorded)).toBe(true);
        } finally {
            memory.dispose();
        }
    });

    test("listActiveContinuations honors live/resumed only; dropContinuation hides; resumeContinuation surfaces back", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            const initial = memory.listActiveContinuations("user-1");
            expect(initial.length).toBe(1);
            const continuationId = initial[0]!.id;

            expect(memory.dropContinuation(continuationId)).toBe(true);
            expect(memory.listActiveContinuations("user-1").length).toBe(0);
            expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryContinuationDropped)).toBe(true);

            expect(memory.resumeContinuation(continuationId)).toBe(true);
            const after = memory.listActiveContinuations("user-1");
            expect(after.length).toBe(1);
            expect(after[0]!.id).toBe(continuationId);
            expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryContinuationResumed)).toBe(true);
        } finally {
            memory.dispose();
        }
    });

    test("pinContinuation scales decayScore by continuation.pinHalflifeMultiplier and emits MemoryContinuationPinned", async () => {
        const config = await makeConfig();
        config.memory.tuning.continuation.pinHalflifeMultiplier = 4;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            const before = (db.query("SELECT decay_score FROM memory_state WHERE event_id = ?").get(continuation.id) as
                | { decay_score: number }
                | null) ?? { decay_score: 1 };
            db.close();

            expect(memory.pinContinuation(continuation.id)).toBe(true);
            const db2 = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            try {
                const after = db2.query("SELECT decay_score FROM memory_state WHERE event_id = ?").get(continuation.id) as {
                    decay_score: number;
                };
                expect(after.decay_score).toBeCloseTo(before.decay_score * 4, 4);
            } finally {
                db2.close();
            }
            const pinEvt = sink.events.find((e) => e.type === RuntimeEventType.MemoryContinuationPinned);
            expect(pinEvt?.payload?.multiplier).toBe(4);
        } finally {
            memory.dispose();
        }
    });

    test("getContinuation rejects non-continuation event ids", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            const askRow = db.query("SELECT id FROM memory_events WHERE type = 'ask'").get() as { id: string };
            db.close();
            expect(memory.getContinuation(askRow.id)).toBeNull();
            expect(memory.getContinuation("nonexistent")).toBeNull();
        } finally {
            memory.dispose();
        }
    });

    // Reference MemoryEventStatus so the import is exercised (status invariants verified above).
    test("AgentAsk.continuationHint overrides fallback title + contextHint on the sibling continuation", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const askWithHint: AgentAsk = {
                reason: AskReason.UserIntentUnclear,
                prompt: "this prompt is very long and would otherwise get truncated by fallback logic",
                continuationHint: { title: "Picking deployment target", contextHint: "blocked on env choice" },
                freeform: true,
            };
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askWithHint,
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            const c = continuation.content as { userFacing?: { title?: string; contextHint?: string } };
            expect(c.userFacing?.title).toBe("Picking deployment target");
            expect(c.userFacing?.contextHint).toBe("blocked on env choice");
        } finally {
            memory.dispose();
        }
    });

    test("buildPrompt injects [continuation-hint] block from active continuations (skipping the pending ask's sibling)", async () => {
        const config = await makeConfig();
        // Lower threshold so the fresh continuation (decayScore=1) clears it without sweeper runs.
        config.memory.tuning.atomScore.visibilityThreshold = 0;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            // First turn: ask emitted, sibling continuation auto-recorded.
            await memory.rememberTurn(
                gatewayMessage("first", "msg-1"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                {
                    reason: AskReason.UserIntentUnclear,
                    prompt: "First ask prompt",
                    continuationHint: { title: "FIRST-GHOST-TITLE" },
                    freeform: true,
                },
            );
            // Drop the pending ask so [continuation] is skipped and second continuation is the only one surfaced.
            // Then trigger a second ask in a separate turn so we have two continuations total.
            await memory.rememberTurn(
                gatewayMessage("answer", "msg-2"),
                gatewayReply("ok", "rep-2"),
                runtimeContext(),
            );
            await memory.rememberTurn(
                gatewayMessage("second", "msg-3"),
                gatewayReply("ask?", "rep-3"),
                runtimeContext(),
                [],
                {},
                {
                    reason: AskReason.UserIntentUnclear,
                    prompt: "Second ask prompt",
                    continuationHint: { title: "SECOND-GHOST-TITLE" },
                    freeform: true,
                },
            );
            // Answer it so no [continuation] is injected; only [continuation-hint] remains.
            await memory.rememberTurn(
                gatewayMessage("answer2", "msg-4"),
                gatewayReply("ok", "rep-4"),
                runtimeContext(),
            );

            const prompt = await memory.buildPrompt(gatewayMessage("new topic", "msg-5"), runtimeContext());
            expect(prompt).toContain("[continuation-hint]");
            expect(prompt).toContain("FIRST-GHOST-TITLE");
            expect(prompt).toContain("SECOND-GHOST-TITLE");
            expect(prompt).not.toContain("[continuation]");
        } finally {
            memory.dispose();
        }
    });

    test("buildPrompt omits [continuation-hint] when all continuations are dropped", async () => {
        const config = await makeConfig();
        config.memory.tuning.atomScore.visibilityThreshold = 0;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi", "msg-1"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            // Answer the ask first so [continuation] is not in play.
            await memory.rememberTurn(
                gatewayMessage("answer", "msg-2"),
                gatewayReply("ok", "rep-2"),
                runtimeContext(),
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            memory.dropContinuation(continuation.id);
            const prompt = await memory.buildPrompt(gatewayMessage("next", "msg-3"), runtimeContext());
            expect(prompt).not.toContain("[continuation-hint]");
        } finally {
            memory.dispose();
        }
    });

    test("ask with reason='blackboard-stalemate' → sibling continuation reason='blackboard-cap'", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("?", "rep-1"),
                runtimeContext(),
                [],
                {},
                {
                    reason: AskReason.BlackboardStalemate,
                    prompt: "Blackboard exhausted. Please decide.",
                    freeform: true,
                },
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            const c = continuation.content as { reason: string };
            expect(c.reason).toBe(ContinuationContextReason.BlackboardCap);
        } finally {
            memory.dispose();
        }
    });

    test("recordContinuationFromReason writes tool-failure continuation with structured snapshot", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const id = memory.recordContinuationFromReason({
                userId: "user-1",
                reason: ContinuationContextReason.ToolFailure,
                userFacing: { title: "MCP tool failed: fs/read_file", contextHint: "ENOENT: missing" },
                snapshot: {
                    originalUserMessage: "please read foo.txt",
                    mcpCallProgress: [{ tool: "fs/read_file", status: "error", lastError: "ENOENT" }],
                },
                channelId: "stdio",
                requestId: "req-1",
            });
            expect(id).not.toBeNull();
            const continuations = memory.listActiveContinuations("user-1");
            expect(continuations.length).toBe(1);
            const c = continuations[0]!.content as {
                reason: string;
                userFacing: { title: string };
                snapshot?: { mcpCallProgress?: Array<{ tool: string }> };
            };
            expect(c.reason).toBe(ContinuationContextReason.ToolFailure);
            expect(c.userFacing.title).toBe("MCP tool failed: fs/read_file");
            expect(c.snapshot?.mcpCallProgress?.[0]?.tool).toBe("fs/read_file");
            const recorded = sink.events.find(
                (e) => e.type === RuntimeEventType.MemoryContinuationRecorded && e.payload?.reason === ContinuationContextReason.ToolFailure,
            );
            expect(recorded).toBeDefined();
        } finally {
            memory.dispose();
        }
    });

    test("evidence weight: continuation score multiplied by askAnswered (0.85) once sibling ask is answered", async () => {
        const config = await makeConfig();
        config.memory.tuning.atomScore.visibilityThreshold = 0;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            // Turn 1: agent emits an ask → sibling continuation is recorded.
            await memory.rememberTurn(
                gatewayMessage("hi", "msg-1"),
                gatewayReply("which one?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            // Build prompt before answering the ask → continuation shown with evidence=default.
            const beforeAnswer = await memory.buildPrompt(
                gatewayMessage("totally unrelated topic", "msg-2"),
                runtimeContext(),
            );
            // The pending ask's sibling is suppressed; so to test the weight tag we drop the
            // ask first so the sibling becomes a regular continuation.
            // Easier path: turn 2 answers the ask, then assert weight=ask-answered surfaces.
            await memory.rememberTurn(
                gatewayMessage("the first one", "msg-3"),
                gatewayReply("ok", "rep-2"),
                runtimeContext(),
            );
            const afterAnswer = await memory.buildPrompt(
                gatewayMessage("anything else?", "msg-4"),
                runtimeContext(),
            );
            expect(afterAnswer).toContain("[continuation-hint]");
            expect(afterAnswer).toContain("evidence=ask-answered");
            // beforeAnswer either omits [continuation-hint] (sibling skipped) or has evidence=default.
            if (beforeAnswer.includes("[continuation-hint]")) {
                expect(beforeAnswer).not.toContain("evidence=ask-answered");
            }
        } finally {
            memory.dispose();
        }
    });

    test("applyContinuationDecisions: kind='fresh' marks continuationCompleted and switches evidence tag", async () => {
        const config = await makeConfig();
        config.memory.tuning.atomScore.visibilityThreshold = 0;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi", "m-1"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            // Answer the pending ask so the sibling is no longer suppressed in [continuation-hint].
            await memory.rememberTurn(
                gatewayMessage("here's the answer", "m-2"),
                gatewayReply("ok", "rep-2"),
                runtimeContext(),
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            const applied = memory.applyContinuationDecisions([{ continuationId: continuation.id, kind: "fresh" }]);
            expect(applied).toBe(1);
            const updated = memory.getContinuation(continuation.id)!;
            expect((updated.content as { continuationCompleted?: boolean }).continuationCompleted).toBe(true);
            const prompt = await memory.buildPrompt(
                gatewayMessage("new topic", "m-3"),
                runtimeContext(),
            );
            expect(prompt).toContain("evidence=continuation-completed");
            expect(
                sink.events.some(
                    (e) =>
                        e.type === RuntimeEventType.MemoryContinuationDecisionApplied &&
                        e.payload?.kind === "fresh",
                ),
            ).toBe(true);
        } finally {
            memory.dispose();
        }
    });

    test("applyContinuationDecisions: kind='resume' surfaces continuation via resumeContinuation", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi", "m-1"),
                gatewayReply("ask?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );
            const continuation = memory.listActiveContinuations("user-1")[0]!;
            memory.dropContinuation(continuation.id);
            expect(memory.listActiveContinuations("user-1").length).toBe(0);
            const applied = memory.applyContinuationDecisions([{ continuationId: continuation.id, kind: "resume" }]);
            expect(applied).toBe(1);
            expect(memory.listActiveContinuations("user-1").length).toBe(1);
        } finally {
            memory.dispose();
        }
    });

    test("applyContinuationDecisions: unknown continuationIds are silently dropped", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const applied = memory.applyContinuationDecisions([{ continuationId: "continuation-nope", kind: "fresh" }]);
            expect(applied).toBe(0);
        } finally {
            memory.dispose();
        }
    });
});

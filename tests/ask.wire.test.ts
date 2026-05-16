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
    type AgentAsk,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

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
    const d = await mkdtemp(join(tmpdir(), "flyflor-ask-wire-"));
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
    prompt: "Did you mean A or B?",
    freeform: true,
};

describe("LF-R3 Ask first-class wiring", () => {
    test("recordAskEvent writes type='ask' to brain with chainDepth=1", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const context = runtimeContext();
            const snapshotId = `behavior-${context.requestId}`;
            await memory.rememberTurn(
                gatewayMessage("hi there"),
                gatewayReply("Did you mean A or B?", "msg-1"),
                context,
                [],
                { behaviorSnapshotId: snapshotId },
                askA,
            );
            const db = new Database(join(config.paths.home, "brain.db"), { readonly: true });
            try {
                const rows = db
                    .query("SELECT id, type, parent_id, content FROM memory_events WHERE type = 'ask' ORDER BY ts DESC")
                    .all() as Array<{ id: string; type: string; parent_id: string | null; content: string }>;
                expect(rows.length).toBe(1);
                expect(rows[0]!.parent_id).toBeNull();
                const c = JSON.parse(rows[0]!.content) as { chainDepth: number; ask: AgentAsk; snapshotId?: string };
                expect(c.chainDepth).toBe(1);
                expect(c.ask.reason).toBe(AskReason.UserIntentUnclear);
                expect(c.snapshotId).toBe(snapshotId);
            } finally {
                db.close();
            }
            const askEvent = sink.events.find((e) => e.type === RuntimeEventType.MemoryAskRecorded);
            expect(askEvent?.payload?.chainDepth).toBe(1);
            expect(askEvent?.payload?.snapshotId).toBe(snapshotId);
        } finally {
            memory.dispose();
        }
    });

    test("user follow-up recorded as ask-answer-pair and continuation block injected before second ask", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            // Turn 1: model emits ask
            await memory.rememberTurn(
                gatewayMessage("hi", "msg-1"),
                gatewayReply("Did you mean A or B?", "rep-1"),
                runtimeContext(),
                [],
                {},
                askA,
            );

            // buildPrompt should inject [continuation] for user-1
            const prompt = await memory.buildPrompt(gatewayMessage("I meant A", "msg-2"), runtimeContext());
            expect(prompt).toContain("[continuation]");
            expect(prompt).toContain("Did you mean A or B?");

            // Turn 2: user's answer (no new ask). rememberTurn should write ask-answer-pair.
            await memory.rememberTurn(
                gatewayMessage("I meant A", "msg-2"),
                gatewayReply("Got it.", "rep-2"),
                runtimeContext(),
            );
            const db = new Database(join(config.paths.home, "brain.db"), { readonly: true });
            try {
                const ans = db
                    .query("SELECT parent_id, content FROM memory_events WHERE type = 'ask-answer-pair'")
                    .all() as Array<{ parent_id: string; content: string }>;
                expect(ans.length).toBe(1);
                const askRow = db.query("SELECT id FROM memory_events WHERE type = 'ask'").get() as { id: string };
                const askContentRow = db.query("SELECT content FROM memory_events WHERE type = 'ask'").get() as {
                    content: string;
                };
                const askContent = JSON.parse(askContentRow.content) as { snapshotId: string };
                expect(ans[0]!.parent_id).toBe(askRow.id);
                const ansContent = JSON.parse(ans[0]!.content) as { snapshotId: string };
                expect(ansContent.snapshotId).toBe(askContent.snapshotId);
                const askState = db.query("SELECT status FROM memory_state WHERE event_id = ?").get(askRow.id) as
                    | { status: string }
                    | null;
                expect(askState?.status).toBe("resumed");

                // Turn 3 buildPrompt: pending ask was answered, so no continuation injected.
                const prompt2 = await memory.buildPrompt(gatewayMessage("ok next", "msg-3"), runtimeContext());
                expect(prompt2).not.toContain("[continuation]");
            } finally {
                db.close();
            }
            expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryAskAnswered)).toBe(true);
        } finally {
            memory.dispose();
        }
    });

    test("chained asks accumulate chainDepth and emit MemoryAskChainCapped past maxChainDepth", async () => {
        const config = await makeConfig();
        // Force tiny cap for deterministic test.
        config.memory.tuning.ghost.maxChainDepth = 2;
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            for (let i = 0; i < 4; i += 1) {
                await memory.rememberTurn(
                    gatewayMessage(`turn ${i}`, `msg-${i}`),
                    gatewayReply(`ask ${i}`, `rep-${i}`),
                    runtimeContext(),
                    [],
                    {},
                    { reason: AskReason.Other, prompt: `q${i}?`, freeform: true },
                );
            }
            const capped = sink.events.filter((e) => e.type === RuntimeEventType.MemoryAskChainCapped);
            expect(capped.length).toBeGreaterThanOrEqual(1);
            const recorded = sink.events.filter((e) => e.type === RuntimeEventType.MemoryAskRecorded);
            const depths = recorded.map((e) => e.payload?.chainDepth);
            expect(depths).toEqual([1, 2, 3, 4]);
        } finally {
            memory.dispose();
        }
    });
});

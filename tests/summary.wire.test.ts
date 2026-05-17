import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { BrainStore } from "../src/neural/memory/brain/store.ts";
import type { MemoryGraphStore, SummaryEmbeddingInput } from "../src/neural/memory/graph/types.ts";
import {
    Channel,
    ChatType,
    MemoryEventType,
    ModelRole,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("MemoryModule.runSummaryOnce (LF-R5 slice B)", () => {
    test("after recording a turn, runSummaryOnce writes day + week summary", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("第一条消息"),
                gatewayReply("收到", "msg-1"),
                runtimeContext(),
            );
            const res = await memory.runSummaryOnce("user-1");
            expect(res).not.toBeNull();
            expect(res!.written).toBeGreaterThan(0);
            expect(sink.types).toContain(RuntimeEventType.MemorySummaryWritten);
        } finally {
            memory.dispose();
        }
    });

    test("runSummaryOnce returns null before brain.db opens (warmup skipped)", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        const res = await memory.runSummaryOnce("user-1");
        expect(res).toBeNull();
        memory.dispose();
    });

    test("brain.db maintenance lock skips summary and archive", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            (memory as unknown as { brainMaintenanceBusy: boolean }).brainMaintenanceBusy = true;
            expect(await memory.runSummaryOnce("user-1")).toBeNull();
            expect(await memory.runBrainArchiveOnce()).toBeNull();
            expect(sink.types).not.toContain(RuntimeEventType.MemorySummaryWritten);
            expect(sink.types).not.toContain(RuntimeEventType.MemoryBrainArchiveCompleted);
        } finally {
            (memory as unknown as { brainMaintenanceBusy: boolean }).brainMaintenanceBusy = false;
            memory.dispose();
        }
    });

    test("runSummaryOnce ignores hot memory compression audit events end to end", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const now = Date.UTC(2026, 4, 13, 12, 0, 0);
            const brain = (memory as unknown as { brain: BrainStore }).brain;
            brain.appendEvent({
                id: "turn-1",
                ts: now - 120_000,
                userId: "user-1",
                channelId: "stdio",
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: { text: "hello" },
                importance: 0.5,
            });
            brain.appendEvent({
                id: "hot-1",
                ts: now - 60_000,
                userId: "user-1",
                channelId: "stdio",
                type: MemoryEventType.HotMemoryCompression,
                role: ModelRole.System,
                content: {
                    batchId: "hot-batch-1",
                    userId: "user-1",
                    reason: "review-due",
                    sourceEpisodeIds: ["ep-1"],
                    deletedEpisodeIds: ["ep-1"],
                    missingEpisodeIds: [],
                    compressedText: "temporary cache cleanup",
                    retainedSignals: ["temporary cache cleanup"],
                    sourceStats: { count: 1 },
                    isolation: {
                        promptVisible: false,
                        memorySummary: false,
                        graphCandidate: false,
                        gemCandidate: false,
                    },
                    createdAt: now - 60_000,
                },
                importance: 0.2,
            });

            const res = await memory.runSummaryOnce("user-1", now);
            expect(res?.written).toBe(2);

            const db = new Database(join(config.paths.home, "brain.db"), { readonly: true });
            try {
                const dayId = "summary-user-1-day-2026-05-13";
                const row = db.query("SELECT content FROM memory_summary WHERE id = ?").get(dayId) as
                    | { content: string }
                    | null;
                expect(row).not.toBeNull();
                const parsed = JSON.parse(row!.content) as { stats?: { byType?: Record<string, number>; totalEvents?: number } };
                expect(parsed.stats?.totalEvents).toBe(1);
                expect(parsed.stats?.byType?.[MemoryEventType.HotMemoryCompression]).toBeUndefined();
            } finally {
                db.close();
            }

            expect(sink.types).toContain(RuntimeEventType.MemorySummaryWritten);
        } finally {
            memory.dispose();
        }
    });

    test("runSummaryOnce writes summary embeddings and backfills embeddingId", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const graph = new FakeSummaryGraph(config);
        const memory = new MemoryModule(config, sink, undefined, { graph: graph as unknown as MemoryGraphStore });
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("summary embedding fixture"),
                gatewayReply("收到", "msg-embed"),
                runtimeContext(),
            );
            const res = await memory.runSummaryOnce("user-1");
            expect(res?.written).toBeGreaterThan(0);
            await waitFor(() => graph.inputs.length > 0);
            expect(graph.inputs[0]?.summaryId).toMatch(/^summary-user-1-/);
            expect(sink.types).toContain(RuntimeEventType.MemorySummaryEmbeddingWritten);
            const db = new Database(join(config.paths.home, "brain.db"), { readonly: true });
            try {
                const rows = db
                    .query("SELECT embedding_id FROM memory_summary WHERE embedding_id IS NOT NULL")
                    .all() as Array<{ embedding_id: string }>;
                expect(rows.length).toBeGreaterThan(0);
                expect(rows[0]?.embedding_id).toMatch(/^summary-embedding-summary-user-1-/);
            } finally {
                db.close();
            }
        } finally {
            memory.dispose();
        }
    });

    test("runSummaryOnce fails loudly when summary embedding sync fails", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const graph = new FailingSummaryGraph(config);
        const memory = new MemoryModule(config, sink, undefined, { graph: graph as unknown as MemoryGraphStore });
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("summary failure fixture"),
                gatewayReply("收到", "msg-fail"),
                runtimeContext(),
            );
            await expect(memory.runSummaryOnce("user-1")).rejects.toThrow("Summary embedding write failed");
            expect(sink.types).toContain(RuntimeEventType.MemorySummaryWritten);
            expect(sink.types).toContain(RuntimeEventType.MemoryBrainWriteFailed);
        } finally {
            memory.dispose();
        }
    });
});

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public get types(): string[] {
        return this.events.map((e) => e.type);
    }
    public publish(event: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(event);
    }
}

class FakeSummaryGraph implements Partial<MemoryGraphStore> {
    public readonly inputs: SummaryEmbeddingInput[] = [];
    public constructor(_config: FlyflorConfig) {}
    public async initialize(): Promise<void> {
        return;
    }
    public async upsertSummaryEmbedding(input: SummaryEmbeddingInput): Promise<void> {
        this.inputs.push(input);
    }
}

class FailingSummaryGraph extends FakeSummaryGraph {
    public override async upsertSummaryEmbedding(_input: SummaryEmbeddingInput): Promise<void> {
        throw new Error("summary embedding down");
    }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("condition not met");
}

async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-summary-wire-"));
    tempRoots.push(dir);
    return dir;
}

function testPaths(root: string): FlyflorPaths {
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
    const paths = testPaths(root);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(dirname(paths.promptDir), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
    await mkdir(dirname(paths.templateDir), { recursive: true });
    await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
    return await loadConfigForPaths(paths);
}

function gatewayMessage(text: string): GatewayMessage {
    return {
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
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

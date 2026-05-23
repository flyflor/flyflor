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
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import type { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
import type { ScopeVectorComponent } from "../src/cognitive/hippocampus/scope/vector/component.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("MemoryModule + BrainStore", () => {
    test("appendEpisode also writes to brain.db memory_events", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("帮我记一下：今天的会议结论是 X。"),
                gatewayReply("好的，已经记下。", "msg-1"),
                runtimeContext(),
            );

            const dbPath = join(config.paths.configDir, "brain.db");
            const db = new Database(dbPath, { readonly: true });
            try {
                const rows = db
                    .query("SELECT id, owner_key, source_key, codename_id, type, content FROM memory_events ORDER BY ts DESC")
                    .all() as Array<{
                        id: string;
                        owner_key: string;
                        source_key: string | null;
                        codename_id: string | null;
                        type: string;
                        content: string;
                    }>;
                expect(rows.length).toBeGreaterThan(0);
                const last = rows[0]!;
                expect(last.owner_key).toBe("fork:test-fork");
                expect(last.source_key?.startsWith("req-")).toBe(true);
                expect(last.type).toBe("event");
                const parsed = JSON.parse(last.content) as Record<string, unknown>;
                expect(parsed.userText).toContain("会议结论");
                expect(parsed.assistantText).toBe("好的，已经记下。");
            } finally {
                db.close();
            }

            expect(sink.types).toContain(RuntimeEventType.MemoryBrainEventWritten);
            expect(sink.types).not.toContain(RuntimeEventType.MemoryBrainWriteFailed);
        } finally {
            memory.dispose();
        }
    });

    test("rememberTurn opens brain.db for direct callers", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        // Direct MemoryModule callers can bypass RuntimeModule.warmup(); rememberTurn owns
        // the lazy-open boundary so CLI/tests/background jobs still hit the single brain.db.
        await memory.rememberTurn(gatewayMessage("hi"), gatewayReply("hello", "msg-2"), runtimeContext());
        expect(sink.types).toContain(RuntimeEventType.MemoryBrainEventWritten);
        expect(sink.types).not.toContain(RuntimeEventType.MemoryBrainWriteFailed);
        memory.dispose();
    });

    test("rememberTurn does not derive brain event ids from reusable client message ids", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        const message = gatewayMessage("same visible message id");
        message.id = "message-1";
        const context = runtimeContext();
        context.requestId = "req-turn-1";
        context.now = "2026-05-23T05:05:00.000Z";

        await memory.rememberTurn(message, gatewayReply("first", "reply-1"), context);
        await memory.rememberTurn(message, gatewayReply("second", "reply-2"), context);

        const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
        try {
            const rows = db.query("SELECT id FROM memory_events WHERE type = 'event' ORDER BY ts").all() as Array<{ id: string }>;
            expect(rows).toHaveLength(2);
            expect(rows[0]?.id).not.toBe(rows[1]?.id);
            expect(rows.map((row) => row.id)).not.toContain("message-1");
        } finally {
            db.close();
        }
        memory.dispose();
    });

    test("markdown memory prompt reads canonical uppercase files and ignores zh.cn mirrors", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        await Bun.write(join(config.paths.workspaceDir, "MEMORY.md"), "canonical memory line\n");
        await Bun.write(join(config.paths.workspaceDir, "MEMORY.zh.cn.md"), "中文镜像不应进入画像\n");
        await Bun.write(join(config.paths.workspaceDir, "SOUL.md"), "legacy soul should not enter runtime prompt\n");

        const prompt = await memory.buildPrompt(gatewayMessage("check markdown memory"), runtimeContext());

        expect(prompt).toContain("canonical memory line");
        expect(prompt).not.toContain("中文镜像不应进入画像");
        expect(prompt).not.toContain("legacy soul should not enter runtime prompt");
        memory.dispose();
    });

    test("model-supplied codename action persists into brain.codenames", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("我们继续推进 fly 这个项目"),
                gatewayReply("好的", "msg-cn-1"),
                runtimeContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "本轮属于 fly 工作上下文",
                        codename: { name: "fly", workingDir: "/tmp/fly", description: "flyflor monorepo" },
                    },
                ],
            );
            const dbPath = join(config.paths.configDir, "brain.db");
            const db = new Database(dbPath, { readonly: true });
            try {
                const rows = db
                    .query("SELECT id, name, working_dir, use_count FROM codenames WHERE name = 'fly'")
                    .all() as Array<{ id: string; name: string; working_dir: string | null; use_count: number }>;
                expect(rows).toHaveLength(1);
                expect(rows[0]!.name).toBe("fly");
                expect(rows[0]!.working_dir).toBe("/tmp/fly");
                expect(rows[0]!.use_count).toBe(1);

                const evRow = db
                    .query("SELECT codename_id FROM memory_events ORDER BY ts DESC LIMIT 1")
                    .get() as { codename_id: string | null };
                expect(evRow.codename_id).toBe(rows[0]!.id);
            } finally {
                db.close();
            }
            expect(sink.types).toContain(RuntimeEventType.MemoryCodenameCreated);

            await memory.rememberTurn(
                gatewayMessage("继续 fly 的工作"),
                gatewayReply("收到", "msg-cn-2"),
                runtimeContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "again on fly",
                        codename: { name: "fly" },
                    },
                ],
            );
            const db2 = new Database(dbPath, { readonly: true });
            try {
                const cn = db2
                    .query("SELECT use_count FROM codenames WHERE name = 'fly'")
                    .get() as { use_count: number };
                expect(cn.use_count).toBe(2);
            } finally {
                db2.close();
            }
            expect(sink.types).toContain(RuntimeEventType.MemoryCodenameTouched);
        } finally {
            memory.dispose();
        }
    });

    test("buildPrompt keeps scope hot memory in prompt without brain.db prompt atoms", async () => {
            const config = await makeConfig();
            const sink = new RecordingSink();
            const memory = new MemoryModule(config, sink);
            await memory.warmup();
        try {
            const ctx = runtimeContext();
            const scope = {
                id: "scope-hot-prompt",
                title: "Hot Prompt Scope",
                goal: "scope.db hot memory should stay in prompt",
                projectDir: join(config.paths.workspaceDir, "scopes", "scope-hot-prompt"),
                projectMemoryDir: join(config.paths.workspaceDir, "scopes", "scope-hot-prompt", ".flyflor", "memory"),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                lastUsedAt: Date.now(),
                useCount: 1,
            };
            const internals = memory as unknown as { brain: BrainStore; scopeVector: ScopeVectorComponent };
            internals.brain.upsertScope(scope);
            await internals.scopeVector.upsertScope({ scope, summary: "scope hot memory fixture", nowMs: Date.now() });
            await internals.scopeVector.recordHotMemory({
                scopeId: scope.id,
                summary: "Scope hot memory fixture",
                text: "scope.db keeps project hot memory visible",
                symbols: ["scope-db", "hot-memory"],
                importance: 0.9,
                nowMs: Date.now(),
            });
            const scopedCtx = { ...ctx, activeScope: { ...scope } };
            await memory.rememberTurn(
                gatewayMessage("brain recall fixture turn"),
                gatewayReply("ok", "msg-brain-1"),
                scopedCtx,
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "brain prompt recall fixture atom",
                        confidence: 0.95,
                        signals: {
                            durability: 1,
                            recurrence: 1,
                            sourceDiversity: 1,
                            validationCount: 1,
                        },
                    },
                ],
            );
            sink.events.length = 0;
            const prompt = await memory.buildPrompt(gatewayMessage("what did we say earlier?"), scopedCtx);
            expect(prompt).toContain("[user] brain recall fixture turn [assistant] ok");
            expect(prompt).toContain("Scope hot memory fixture");
            expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryBrainPromptRecall)).toBe(false);
        } finally {
            memory.dispose();
        }
    });

    test("pending ASK continuation survives monthly brain shard sealing", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const ask: AgentAsk = {
                reason: AskReason.UserIntentUnclear,
                prompt: "Which archived path should continue?",
                freeform: true,
                continuationHint: { title: "Archived ask continuation" },
            };
            await memory.rememberTurn(
                gatewayMessage("archive ask fixture"),
                gatewayReply("Which archived path should continue?", "msg-ask-archive"),
                runtimeContext(),
                [],
                {},
                ask,
            );

            const brain = (memory as unknown as { brain: BrainStore }).brain;
            const sealed = brain.sealLiveShardIfStale(Date.parse("2026-06-01T00:00:00.000Z"));
            expect(sealed?.status).toBe("archived");

            const prompt = await memory.buildPrompt(gatewayMessage("continue the archived one"), runtimeContext());
            expect(prompt).toContain("[continuation]");
            expect(prompt).toContain("Which archived path should continue?");
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

async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-brain-wire-"));
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
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, conversationKey: "chat-1" },
    };
}

function gatewayReply(text: string, messageId: string): GatewayReply {
    return {
        messageId,
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, conversationKey: "chat-1" },
        text,
    };
}

function runtimeContext(): RuntimeContext {
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
        contextForkId: "test-fork",
    };
}

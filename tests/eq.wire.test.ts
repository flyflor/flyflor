import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    EqLabel,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("EQ-01 slice A: rememberTurn persists action.eq into brain.memory_eq_state", () => {
    test("eq action → upsert + MemoryEqStateUpdated event", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("一段消息"),
                gatewayReply("好", "msg-eq-1"),
                runtimeContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "carrier",
                        eq: {
                            label: EqLabel.Joy,
                            valence: 0.6,
                            arousal: 0.4,
                            dominance: 0.5,
                            confidence: 0.8,
                        },
                    },
                ],
            );

            const dbPath = join(config.paths.configDir, "brain.db");
            const db = new Database(dbPath, { readonly: true });
            try {
                const row = db
                    .query(
                        "SELECT user_id, label, valence, arousal, dominance, confidence FROM memory_eq_state WHERE user_id = 'user-1'",
                    )
                    .get() as
                    | {
                          user_id: string;
                          label: string;
                          valence: number;
                          arousal: number;
                          dominance: number;
                          confidence: number;
                      }
                    | null;
                expect(row).not.toBeNull();
                expect(row!.label).toBe("joy");
                expect(row!.valence).toBeCloseTo(0.6, 3);
                expect(row!.arousal).toBeCloseTo(0.4, 3);
                expect(row!.dominance).toBeCloseTo(0.5, 3);
                expect(row!.confidence).toBeCloseTo(0.8, 3);
            } finally {
                db.close();
            }

            const updated = sink.events.find((e) => e.type === RuntimeEventType.MemoryEqStateUpdated) as
                | { type: string; payload?: { userId?: string; label?: string } }
                | undefined;
            expect(updated).toBeTruthy();
            expect(updated!.payload?.userId).toBe("user-1");
            expect(updated!.payload?.label).toBe("joy");
        } finally {
            memory.dispose();
        }
    });

    test("无 eq action → 不写表 / 不发事件", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ok", "msg-eq-2"),
                runtimeContext(),
                [],
            );
            const dbPath = join(config.paths.configDir, "brain.db");
            const db = new Database(dbPath, { readonly: true });
            try {
                const row = db.query("SELECT COUNT(*) as n FROM memory_eq_state").get() as { n: number };
                expect(row.n).toBe(0);
            } finally {
                db.close();
            }
            expect(sink.types).not.toContain(RuntimeEventType.MemoryEqStateUpdated);
        } finally {
            memory.dispose();
        }
    });

    test("非法 eq 字段（非封闭 label）被 normalize 丢弃；零字符匹配——不写表", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ok", "msg-eq-3"),
                runtimeContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "bad eq",
                        eq: {
                            label: "happy" as unknown as EqLabel,
                            valence: 0.5,
                            arousal: 0.5,
                            dominance: 0.5,
                            confidence: 0.5,
                        },
                    },
                ],
            );
            const dbPath = join(config.paths.configDir, "brain.db");
            const db = new Database(dbPath, { readonly: true });
            try {
                const row = db.query("SELECT COUNT(*) as n FROM memory_eq_state").get() as { n: number };
                expect(row.n).toBe(0);
            } finally {
                db.close();
            }
            expect(sink.types).not.toContain(RuntimeEventType.MemoryEqStateUpdated);
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
    const dir = await mkdtemp(join(tmpdir(), "flyflor-eq-wire-"));
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

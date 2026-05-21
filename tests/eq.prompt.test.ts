import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    EQ_DEFAULT_HALFLIFE_MS,
    EqLabel,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import type { EventSink } from "../src/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("EQ-01 slice B: buildPrompt injects [eq-context] from brain.memory_eq_state", () => {
    const scopedContext = () => runtimeContext("scope-eq");

    test("没有 EQ state → 不注入 [eq-context]", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const prompt = await memory.buildPrompt(gatewayMessage("hi"), runtimeContext());
            expect(prompt).not.toContain("[eq-context]");
        } finally {
            memory.dispose();
        }
    });

    test("有非平复 EQ state → 注入 [eq-context]，含 label + 衰减后数值", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            // 第一轮：模型给出 eq=joy
            await memory.rememberTurn(
                gatewayMessage("一段开心的消息"),
                gatewayReply("好", "msg-eq-p1"),
                scopedContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "carrier",
                        eq: {
                            label: EqLabel.Joy,
                            valence: 0.8,
                            arousal: 0.6,
                            dominance: 0.5,
                            confidence: 0.9,
                        },
                    },
                ],
            );
            const prompt = await memory.buildPrompt(gatewayMessage("第二轮"), scopedContext());
            expect(prompt).toContain("[eq-context]");
            expect(prompt).toContain("label=joy");
            // 立即 buildPrompt（dt≈0），valence 应接近原值
            expect(prompt).toMatch(/valence=0\.\d{2}/);
            // 必须含"不要基于关键词派生 label"的红线指引
            expect(prompt.toLowerCase()).toContain("never derive a label");
            // EQ-02: high-arousal + 正 valence + joy → MatchEnergy directive
            expect(prompt).toContain("directive=match-energy");
        } finally {
            memory.dispose();
        }
    });

    test("EQ state 衰减到接近 0 → 不注入（避免噪音）", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("hi"),
                gatewayReply("ok", "msg-eq-p2"),
                scopedContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "carrier",
                        eq: {
                            label: EqLabel.Neutral,
                            // 选低值，几个半衰期后 |valence| < 0.05 + arousal < 0.05
                            valence: 0.1,
                            arousal: 0.05,
                            dominance: 0.5,
                            confidence: 0.5,
                        },
                    },
                ],
            );
            // 手动把 updated_at 调到很久以前（10 个半衰期），让 decay 把它降到阈值之下
            const dbPath = join(config.paths.configDir, "brain.db");
            const { Database } = await import("bun:sqlite");
            const db = new Database(dbPath);
            try {
                const past = Date.now() - 10 * EQ_DEFAULT_HALFLIFE_MS;
                db.run("UPDATE memory_eq_state SET updated_at = ? WHERE owner_key = 'scope:scope-eq'", [past]);
            } finally {
                db.close();
            }
            const prompt = await memory.buildPrompt(gatewayMessage("第二轮"), scopedContext());
            expect(prompt).not.toContain("[eq-context]");
        } finally {
            memory.dispose();
        }
    });

    test("EQ-02: confidence < 0.3 → 注入 [eq-context] 但不附 directive 行", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gatewayMessage("一段消息"),
                gatewayReply("好", "msg-eq-p3"),
                scopedContext(),
                [
                    {
                        action: "add",
                        target: "memory",
                        content: "carrier",
                        eq: {
                            label: EqLabel.Anger,
                            valence: -0.6,
                            arousal: 0.7,
                            dominance: 0.4,
                            // 极低置信度 → directive 应被抑制
                            confidence: 0.2,
                        },
                    },
                ],
            );
            const prompt = await memory.buildPrompt(gatewayMessage("第二轮"), scopedContext());
            expect(prompt).toContain("[eq-context]");
            expect(prompt).toContain("label=anger");
            expect(prompt).not.toContain("directive=");
        } finally {
            memory.dispose();
        }
    });
});

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(event: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(event);
    }
}

async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-eq-prompt-"));
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

function runtimeContext(scopeId?: string): RuntimeContext {
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
        ...(scopeId
            ? {
                  activeScope: {
                      id: scopeId,
                      title: "EQ Scope",
                      projectDir: "/tmp/eq-scope",
                      projectMemoryDir: "/tmp/eq-scope/.flyflor/memory",
                  },
              }
            : {}),
    };
}

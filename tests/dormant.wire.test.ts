import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    RuntimeMode,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { type EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("MemoryModule.dormant (LF-R5 slice D)", () => {
    test("rememberTurn touches dormant supervisor → user is Chat", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(gatewayMessage("hi"), gatewayReply("hello", "m1"), runtimeContext());
            expect(memory.runtimeModeOf("user-1")).toBe(RuntimeMode.Chat);
            const snap = memory.dormantSnapshot();
            expect(snap.find((s) => s.userId === "user-1")?.mode).toBe(RuntimeMode.Chat);
        } finally {
            memory.dispose();
        }
    });

    test("sweepDormantOnce is a no-op when no users registered", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        const r = memory.sweepDormantOnce();
        expect(r.entered).toBe(0);
        memory.dispose();
    });

    test("LF-R8 buildPrompt injects [runtime-resume] when user is Dormant before touch", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(gatewayMessage("first turn"), gatewayReply("ok", "m1"), runtimeContext());
            // 强制把该用户切到 Dormant（不真等 60s）
            (memory as unknown as { dormant: { sweepOnce: () => unknown; touch: (u: string) => void } }).dormant;
            // 取出 supervisor 内部状态：把 lastInputAt 拨到 1 小时前，sweep 切换
            const sup = (memory as unknown as { dormant: { sweepOnce: () => { entered: number }; modeOf: (u: string) => string } }).dormant;
            // 直接通过 protected 路径：访问 states map（cast）
            const internal = sup as unknown as { states: Map<string, { lastInputAt: number; mode: string }>; idleMs: number };
            const cur = internal.states.get("user-1");
            if (cur) cur.lastInputAt = Date.now() - 75 * 60_000;
            sup.sweepOnce();
            expect(sup.modeOf("user-1")).toBe(RuntimeMode.Dormant);
            const prompt = await memory.buildPrompt(gatewayMessage("hi after dormant"), runtimeContext());
            expect(prompt).toContain("[runtime-resume]");
            expect(prompt).toMatch(/User just returned after [^\n]*of inactivity/);
        } finally {
            memory.dispose();
        }
    });

    test("LF-R8 buildPrompt does NOT inject [runtime-resume] when user is in Chat", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            await memory.rememberTurn(gatewayMessage("hi"), gatewayReply("hello", "m1"), runtimeContext());
            const prompt = await memory.buildPrompt(gatewayMessage("hi again"), runtimeContext());
            expect(prompt).not.toContain("[runtime-resume]");
        } finally {
            memory.dispose();
        }
    });
});

class NoopSink implements EventSink {
    public publish(_event: { type: string; payload?: Record<string, unknown> }): void {}
}

async function tempRoot(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-dormant-wire-"));
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

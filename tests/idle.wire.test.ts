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
import { type EventSink } from "../src/events/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("MemoryModule.idle (LF-R5 slice D)", () => {
    test("rememberTurn touches idle supervisor → owner is Chat", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            const message = gatewayMessage("hi", "msg-idle-1");
            await memory.rememberTurn(message, gatewayReply("hello", "m1"), runtimeContext());
            expect(memory.runtimeModeOf("turn:msg-idle-1")).toBe(RuntimeMode.Chat);
            const snap = memory.idleSnapshot();
            expect(snap.find((s) => s.ownerKey === "turn:msg-idle-1")?.mode).toBe(RuntimeMode.Chat);
        } finally {
            memory.dispose();
        }
    });

    test("sweepIdleOnce is a no-op when no users registered", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        const r = memory.sweepIdleOnce();
        expect(r.entered).toBe(0);
        memory.dispose();
    });

    test("LF-R8 buildPrompt injects [runtime-resume] when user is Idle before touch", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            const first = gatewayMessage("first turn", "msg-idle-first");
            await memory.rememberTurn(first, gatewayReply("ok", "m1"), runtimeContext());
            // 强制把该 owner 切到 Idle（不真等 60s）
            (memory as unknown as { idle: { sweepOnce: () => unknown; touch: (u: string) => void } }).idle;
            // 取出 supervisor 内部状态：把 lastInputAt 拨到 1 小时前，sweep 切换
            const sup = (memory as unknown as { idle: { sweepOnce: () => { entered: number }; modeOf: (u: string) => string } }).idle;
            // 直接通过 protected 路径：访问 states map（cast）
            const internal = sup as unknown as { states: Map<string, { lastInputAt: number; mode: string }>; idleMs: number };
            const cur = internal.states.get("turn:msg-idle-first");
            if (cur) cur.lastInputAt = Date.now() - 75 * 60_000;
            sup.sweepOnce();
            expect(sup.modeOf("turn:msg-idle-first")).toBe(RuntimeMode.Idle);
            const prompt = await memory.buildPrompt(gatewayMessage("hi after idle", "msg-idle-first"), runtimeContext());
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
    const dir = await mkdtemp(join(tmpdir(), "flyflor-idle-wire-"));
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

function gatewayMessage(text: string, id?: string): GatewayMessage {
    return {
        id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
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

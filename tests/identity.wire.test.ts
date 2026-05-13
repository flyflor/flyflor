import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

class RecordingSink implements EventSink {
    readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(evt);
    }
}

async function tempRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-identity-wire-"));
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
    await mkdir(dirname(p.promptDir), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), p.promptDir, "dir");
    await mkdir(dirname(p.templateDir), { recursive: true });
    await symlink(join(repoRoot, "templates"), p.templateDir, "dir");
    return await loadConfigForPaths(p);
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

function runtimeContext(): RuntimeContext {
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
    };
}

describe("LF-R5 identity self-write wiring", () => {
    test("applyIdentityAppends writes events and listIdentity returns them", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const ids = memory.applyIdentityAppends({
                userId: "user-1",
                candidates: [
                    { kind: "preference", content: "concise replies", confidence: 0.9 },
                    { kind: "constraint", content: "never auto-commit", confidence: 1 },
                ],
            });
            expect(ids.length).toBe(2);
            const live = memory.listIdentity("user-1");
            expect(live.length).toBe(2);
            const kinds = live.map((r) => (r.content as { kind?: string }).kind).sort();
            expect(kinds).toEqual(["constraint", "preference"]);
            expect(
                sink.events.filter((e) => e.type === RuntimeEventType.MemoryIdentityAppended).length,
            ).toBe(2);
        } finally {
            memory.dispose();
        }
    });

    test("revertIdentity hides entry from listIdentity (live) but keeps it in full history", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const [id] = memory.applyIdentityAppends({
                userId: "user-1",
                candidates: [{ kind: "preference", content: "first entry" }],
            });
            expect(memory.listIdentity("user-1").length).toBe(1);
            const ok = memory.revertIdentity(id!);
            expect(ok).toBe(true);
            expect(memory.listIdentity("user-1").length).toBe(0);
            expect(memory.listIdentity("user-1", { includeReverted: true }).length).toBe(1);
            const reverted = memory.listIdentity("user-1", { includeReverted: true })[0]!;
            expect(typeof (reverted.content as { revertedAt?: number }).revertedAt).toBe("number");
            expect(
                sink.events.some((e) => e.type === RuntimeEventType.MemoryIdentityReverted),
            ).toBe(true);
        } finally {
            memory.dispose();
        }
    });

    test("revertIdentity rejects non-identity events", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            expect(memory.revertIdentity("does-not-exist")).toBe(false);
        } finally {
            memory.dispose();
        }
    });

    test("buildPrompt injects [identity] block when live identity entries exist", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            memory.applyIdentityAppends({
                userId: "user-1",
                candidates: [
                    { kind: "preference", content: "uses Markdown tables in replies" },
                    { kind: "goal", content: "ship the flyflor launch by month-end" },
                ],
            });
            const prompt = await memory.buildPrompt(
                gatewayMessage("hello"),
                runtimeContext(),
            );
            expect(prompt).toContain("[identity]");
            expect(prompt).toContain("uses Markdown tables in replies");
            expect(prompt).toContain("(goal)");
        } finally {
            memory.dispose();
        }
    });

    test("buildPrompt omits [identity] block after all entries are reverted", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            const [id] = memory.applyIdentityAppends({
                userId: "user-1",
                candidates: [{ kind: "preference", content: "verbose mode" }],
            });
            memory.revertIdentity(id!);
            const prompt = await memory.buildPrompt(
                gatewayMessage("hello"),
                runtimeContext(),
            );
            expect(prompt).not.toContain("[identity]");
        } finally {
            memory.dispose();
        }
    });
});

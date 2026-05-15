import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { fetchInboxBuckets } from "../src/command/cli/handlers/inbox.handler.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import type { MemoryAction } from "../src/neural/memory/actions.ts";
import { type EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

class NoopSink implements EventSink {
    publish(): void {}
}

async function tempRoot(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "flyflor-inbox-cli-"));
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

function dirname(p: string): string {
    return p.replace(/\/[^/]+$/, "");
}

function gwMsg(text: string, id = `m-${Math.random().toString(36).slice(2, 8)}`): GatewayMessage {
    return {
        id,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "user-inbox-cli", displayName: "U" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
    };
}
function gwReply(text: string, messageId: string): GatewayReply {
    return {
        messageId,
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-1" },
        text,
    };
}
function ctx(): RuntimeContext {
    return { requestId: `r-${Math.random().toString(36).slice(2, 8)}`, now: new Date().toISOString(), embedding: [] };
}
function actionAdd(content: string, codename?: { name: string }): MemoryAction {
    const a: MemoryAction = { action: "add", target: "memory", content };
    if (codename) a.codename = codename;
    return a;
}

describe("P2 inbox slice C — fetchInboxBuckets handler", () => {
    test("buckets group: codename atoms + uncoded atoms 各自占桶；已升格 project 不进 inbox", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new NoopSink());
        await memory.warmup();
        try {
            // 三 turns，分别贴 codename=fly、codename=alpha、不贴 codename
            await memory.rememberTurn(gwMsg("about fly", "m-1"), gwReply("ack", "m-1"), ctx(), [
                actionAdd("fly note", { name: "fly" }),
            ]);
            await memory.rememberTurn(gwMsg("about fly again", "m-2"), gwReply("ack", "m-2"), ctx(), [
                actionAdd("another fly note", { name: "fly" }),
            ]);
            await memory.rememberTurn(gwMsg("about alpha", "m-3"), gwReply("ack", "m-3"), ctx(), [
                actionAdd("alpha note", { name: "alpha" }),
            ]);
            await memory.rememberTurn(gwMsg("misc", "m-4"), gwReply("ack", "m-4"), ctx(), [
                actionAdd("uncoded note"),
            ]);
            // Inbox CLI must read brain.db authority, not the legacy journal audit copy.
            await rm(config.paths.journalDir ?? join(config.paths.home, "journal"), { recursive: true, force: true });

            const result = await fetchInboxBuckets(config, { userId: "user-inbox-cli" });
            expect(result.brainPresent).toBe(true);
            expect(result.atomCount).toBeGreaterThanOrEqual(4);
            // 桶应有 3 个：cn-fly / cn-alpha / inbox（uncoded）
            const labels = result.buckets.map((b) => b.codenameName).sort();
            expect(labels).toEqual(["(uncoded)", "alpha", "fly"]);
            const flyBucket = result.buckets.find((b) => b.codenameName === "fly");
            expect(flyBucket).toBeTruthy();
            expect(flyBucket!.projectId.startsWith("inbox:cn-")).toBe(true);
            expect(flyBucket!.atomCount).toBeGreaterThanOrEqual(2);
            const uncoded = result.buckets.find((b) => b.codenameName === "(uncoded)");
            expect(uncoded?.projectId).toBe("inbox");
        } finally {
            memory.dispose();
        }
    });

    test("空 inbox：fetchInboxBuckets 返回空 buckets + atomCount=0", async () => {
        const config = await makeConfig();
        const result = await fetchInboxBuckets(config, { userId: "user-empty" });
        expect(result.atomCount).toBe(0);
        expect(result.buckets).toEqual([]);
    });
});

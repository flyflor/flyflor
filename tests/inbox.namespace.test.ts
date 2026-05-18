import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { inboxProjectIdFor, isInboxProjectId } from "../src/cognitive/hippocampus/memory/index.ts";
import type { MemoryAction } from "../src/cognitive/hippocampus/memory/actions/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    MemoryEventType,
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
    const d = await mkdtemp(join(tmpdir(), "flyflor-inbox-ns-"));
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

function gwMsg(text: string, id = `msg-${Math.random().toString(36).slice(2, 8)}`): GatewayMessage {
    return {
        id,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "user-inbox-ns", displayName: "User" },
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
    return {
        requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        now: new Date().toISOString(),
        embedding: [],
    };
}

function actionAdd(content: string, codename?: { name: string; workingDir?: string; description?: string }): MemoryAction {
    const a: MemoryAction = { action: "add", target: "memory", content };
    if (codename) a.codename = codename;
    return a;
}

describe("P2 inbox slice A — projectId namespacing by codename", () => {
    test("inboxProjectIdFor / isInboxProjectId predicate boundaries", () => {
        expect(inboxProjectIdFor()).toBe("inbox");
        expect(inboxProjectIdFor(undefined)).toBe("inbox");
        expect(inboxProjectIdFor(null)).toBe("inbox");
        expect(inboxProjectIdFor("")).toBe("inbox");
        expect(inboxProjectIdFor("cn-abc")).toBe("inbox:cn-cn-abc");
        expect(isInboxProjectId("inbox")).toBe(true);
        expect(isInboxProjectId("inbox:cn-anything")).toBe(true);
        expect(isInboxProjectId("project-abc123")).toBe(false);
        expect(isInboxProjectId("inboxx")).toBe(false);
    });

    test("turn with no codename action → atom.projectId === 'inbox' + inboxDecayApplied", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gwMsg("hello", "m-1"),
                gwReply("hi", "m-1"),
                ctx(),
                [actionAdd("just a note")],
            );
            const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            try {
                const event = db
                    .query("SELECT content FROM memory_events WHERE type = ? ORDER BY ts DESC LIMIT 1")
                    .get(MemoryEventType.Event) as { content: string } | null;
                const atoms = readBrainAtoms(event?.content);
                expect(atoms[0]?.projectId).toBe("inbox");
                expect(isInboxProjectId(String(atoms[0]?.projectId))).toBe(true);
            } finally {
                db.close();
            }
        } finally {
            memory.dispose();
        }
    });

    test("turn with codename action → atom.projectId namespaced as 'inbox:cn-<id>' and isInboxProjectId true", async () => {
        const config = await makeConfig();
        const sink = new RecordingSink();
        const memory = new MemoryModule(config, sink);
        await memory.warmup();
        try {
            await memory.rememberTurn(
                gwMsg("working on fly", "m-1"),
                gwReply("ack", "m-1"),
                ctx(),
                [actionAdd("note about fly", { name: "fly" })],
            );
            const created = sink.events.find((e) => e.type === RuntimeEventType.MemoryCodenameCreated);
            expect(created).toBeTruthy();
            const codenameId = String(created?.payload?.id);
            expect(codenameId.startsWith("cn-")).toBe(true);

            // 同样 brain.codenames 表也写入了
            const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
            try {
                const event = db
                    .query("SELECT content FROM memory_events WHERE type = ? ORDER BY ts DESC LIMIT 1")
                    .get(MemoryEventType.Event) as { content: string } | null;
                const atoms = readBrainAtoms(event?.content);
                const projId = String(atoms[0]?.projectId);
                expect(projId).toBe(inboxProjectIdFor(codenameId));
                expect(projId.startsWith("inbox:cn-")).toBe(true);
                expect(isInboxProjectId(projId)).toBe(true);

                const cn = db
                    .query("SELECT id, name FROM codenames WHERE user_id = ? AND name = ?")
                    .get("user-inbox-ns", "fly") as { id: string; name: string } | null;
                expect(cn).toBeTruthy();
                expect(cn!.id).toBe(codenameId);
            } finally {
                db.close();
            }
        } finally {
            memory.dispose();
        }
    });
});

function readBrainAtoms(rawContent: string | undefined): Array<{ projectId?: string }> {
    const content = rawContent ? (JSON.parse(rawContent) as { atoms?: Array<{ atom?: { projectId?: string } }> }) : {};
    return (content.atoms ?? []).map((entry) => entry.atom ?? {});
}

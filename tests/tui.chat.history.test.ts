import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    MemoryEventType,
    ModelRole,
    SceneRecordKind,
    TaskPlanStatus,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { type EventSink } from "../src/events/index.ts";
import type { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(evt);
    }
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-chat-history-"));
    tempRoots.push(root);
    return root;
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

function gatewayMessage(text: string, id: string, receivedAt: string): GatewayMessage {
    return {
        id,
        receivedAt,
        text,
        attachments: [],
        user: { id: "history-user", displayName: "User" },
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-history" },
    };
}

function gatewayReply(text: string, id: string): GatewayReply {
    return {
        messageId: id,
        route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "chat-history" },
        text,
    };
}

function runtimeContext(id: string, now: string): RuntimeContext {
    return { requestId: id, now, embedding: [] };
}

describe("TUI chat history source", () => {
    test("lists chat turns chronologically and pages older turns by timestamp", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const times = [
                "2026-05-14T00:00:01.000Z",
                "2026-05-14T00:00:02.000Z",
                "2026-05-14T00:00:03.000Z",
            ];
            for (let idx = 0; idx < times.length; idx += 1) {
                await memory.rememberTurn(
                    gatewayMessage(`u${idx + 1}`, `msg-${idx + 1}`, times[idx]!),
                    gatewayReply(`a${idx + 1}`, `rep-${idx + 1}`),
                    runtimeContext(`req-${idx + 1}`, times[idx]!),
                );
            }

            const latest = memory.listChatHistory("history-user", { limit: 2 });
            expect(latest.map((turn) => [turn.userText, turn.assistantText])).toEqual([
                ["u2", "a2"],
                ["u3", "a3"],
            ]);

            const older = memory.listChatHistory("history-user", { beforeTs: latest[0]!.ts - 1, limit: 2 });
            expect(older.map((turn) => [turn.userText, turn.assistantText])).toEqual([["u1", "a1"]]);
        } finally {
            memory.dispose();
        }
    });

    test("throws when a persisted chat history event is malformed", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const brain = (memory as unknown as { brain: BrainStore }).brain;
            brain.appendEvent({
                id: "bad-history-event",
                ts: Date.parse("2026-05-14T00:00:04.000Z"),
                userId: "history-user",
                channelId: Channel.Stdio,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: { userText: "missing assistant text" },
            });
            expect(() => memory.listChatHistory("history-user", { limit: 1 })).toThrow(
                "Invalid chat history event bad-history-event: missing assistantText",
            );
        } finally {
            memory.dispose();
        }
    });

    test("includes persisted planning metadata for history side-panel replay", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const now = "2026-05-14T00:00:05.000Z";
            await memory.rememberTurn(
                gatewayMessage("plan it", "msg-plan", now),
                gatewayReply("planned", "rep-plan"),
                runtimeContext("req-plan", now),
                [],
                {},
                undefined,
                {
                    taskPlans: [
                        {
                            id: "plan-1",
                            userId: "history-user",
                            title: "Plan",
                            summary: "Summary",
                            status: TaskPlanStatus.Planned,
                            progress: 0,
                            stepCount: 1,
                            completedStepCount: 0,
                            step: [{ id: "s1", title: "Step", status: TaskPlanStatus.Planned, order: 0 }],
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                    sceneRecords: [
                        {
                            id: "scene-1",
                            userId: "history-user",
                            kind: SceneRecordKind.DeepThink,
                            title: "Scene",
                            summary: "Replay summary",
                            visibleFacts: [],
                            openQuestions: [],
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                },
            );

            const latest = memory.listChatHistory("history-user", { limit: 1 });
            expect(latest[0]?.taskPlans?.[0]?.title).toBe("Plan");
            expect(latest[0]?.scenes?.[0]?.summary).toBe("Replay summary");
        } finally {
            memory.dispose();
        }
    });
});

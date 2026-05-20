import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { MemoryModule } from "../src/agent/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    AskReason,
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

            const latest = memory.listChatHistory({ limit: 2 });
            expect(latest.map((turn) => [turn.userText, turn.assistantText])).toEqual([
                ["u2", "a2"],
                ["u3", "a3"],
            ]);

            const older = memory.listChatHistory({ beforeTs: latest[0]!.ts - 1, limit: 2 });
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
            expect(() => memory.listChatHistory({ limit: 1 })).toThrow(
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

            const latest = memory.listChatHistory({ limit: 1 });
            expect(latest[0]?.taskPlans?.[0]?.title).toBe("Plan");
            expect(latest[0]?.scenes?.[0]?.summary).toBe("Replay summary");
        } finally {
            memory.dispose();
        }
    });

    test("persists deep-think history data for future TUI ask-loop rendering", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const now = "2026-05-14T00:00:06.000Z";
            await memory.rememberTurn(
                gatewayMessage("帮我规划一个多阶段的电脑控制执行方案", "msg-deep-think", now),
                gatewayReply("我先拆解计划，并确认第一步。", "rep-deep-think"),
                runtimeContext("req-deep-think", now),
                [],
                {
                    behaviorSnapshotId: "behavior-deep-think-1",
                },
                {
                    reason: AskReason.UserIntentUnclear,
                    prompt: "先确认你希望我先做“只读探测”还是直接“执行控制”吗？",
                    freeform: true,
                    choices: [
                        { value: "probe", label: "先探测", description: "先读取环境、确认风险，再进入执行" },
                        { value: "execute", label: "直接执行", description: "直接进入控制步骤，后续按 ask 收口" },
                    ],
                },
                {
                    contextForks: [
                        {
                            id: "fork-deep-think-1",
                            userId: "history-user",
                            title: "电脑控制规划",
                            summary: "为外骨骼控制任务拆出单独上下文分支",
                            continuitySummary: "只保留电脑控制协议、权限和执行计划",
                            maxContextTokens: 32000,
                            inheritedEventIds: ["msg-deep-think"],
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                    taskPlans: [
                        {
                            id: "plan-deep-think-1",
                            userId: "history-user",
                            title: "电脑控制长线方案",
                            summary: "先探测环境，再执行动作，最后回收状态",
                            status: TaskPlanStatus.InProgress,
                            progress: 0.34,
                            stepCount: 3,
                            completedStepCount: 1,
                            step: [
                                { id: "step-1", title: "确认控制范围与约束", status: TaskPlanStatus.Done, order: 0, progress: 1 },
                                { id: "step-2", title: "探测目标环境并回显观察结果", status: TaskPlanStatus.InProgress, order: 1, progress: 0.4 },
                                { id: "step-3", title: "执行动作并等待用户确认", status: TaskPlanStatus.Waiting, order: 2, progress: 0 },
                            ],
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                    sceneRecords: [
                        {
                            id: "scene-deep-think-1",
                            userId: "history-user",
                            kind: SceneRecordKind.DeepThink,
                            title: "深度思考：电脑控制计划",
                            summary: "需要长线规划、ask 收口和上下文分支",
                            detail: "该回合需要先做环境探测，再选择执行路径，最后把控制动作挂到 ask-loop 上。",
                            visibleFacts: ["任务涉及电脑控制", "需要 long-horizon loop", "当前尚未确认先探测还是直接执行"],
                            openQuestions: ["是否先做只读探测？", "是否允许直接执行控制动作？"],
                            taskPlanId: "plan-deep-think-1",
                            contextForkId: "fork-deep-think-1",
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                },
            );

            const latest = memory.listChatHistory({ limit: 1 });
            expect(latest[0]?.contextForks?.[0]).toMatchObject({
                id: "fork-deep-think-1",
                title: "电脑控制规划",
            });
            expect(latest[0]?.taskPlans?.[0]).toMatchObject({
                id: "plan-deep-think-1",
                title: "电脑控制长线方案",
                status: TaskPlanStatus.InProgress,
            });
            expect(latest[0]?.scenes?.[0]).toMatchObject({
                id: "scene-deep-think-1",
                kind: SceneRecordKind.DeepThink,
                openQuestions: ["是否先做只读探测？", "是否允许直接执行控制动作？"],
            });
        } finally {
            memory.dispose();
        }
    });

    test("persists blackboard replay data for future TUI discussion rendering", async () => {
        const config = await makeConfig();
        const memory = new MemoryModule(config, new RecordingSink());
        await memory.warmup();
        try {
            const now = "2026-05-14T00:00:07.000Z";
            await memory.rememberTurn(
                gatewayMessage("对比两种 ws 血管协议设计并给出收口建议", "msg-blackboard", now),
                gatewayReply("我已经让黑板收敛出协议建议。", "rep-blackboard"),
                runtimeContext("req-blackboard", now),
                [],
                {
                    blackboardTurnId: "bb-turn-1",
                },
                undefined,
                {
                    taskPlans: [
                        {
                            id: "plan-blackboard-1",
                            userId: "history-user",
                            title: "协议收口",
                            summary: "收敛 WS 控制面、事件面和恢复面",
                            status: TaskPlanStatus.Done,
                            progress: 1,
                            stepCount: 3,
                            completedStepCount: 3,
                            step: [
                                { id: "bb-step-1", title: "对比多种协议边界", status: TaskPlanStatus.Done, order: 0, progress: 1 },
                                { id: "bb-step-2", title: "识别最小稳定字段", status: TaskPlanStatus.Done, order: 1, progress: 1 },
                                { id: "bb-step-3", title: "输出最终收口建议", status: TaskPlanStatus.Done, order: 2, progress: 1 },
                            ],
                            createdAt: now,
                            updatedAt: now,
                            sourceBlackboardTurnId: "bb-turn-1",
                        },
                    ],
                    sceneRecords: [
                        {
                            id: "scene-blackboard-1",
                            userId: "history-user",
                            kind: SceneRecordKind.Blackboard,
                            title: "Blackboard Converged",
                            summary: "黑板已收敛到单一 WS 协议建议",
                            detail: [
                                "Route: protocol-comparison",
                                "Status: converged",
                                "Round 1 analyst: 比较 ws / sse / http polling 的交互成本",
                                "Round 2 skeptic: 指出恢复语义和 ask-loop 不能丢",
                                "decision: 保留 ws，冻结 ask/todo/data/event 协议面",
                            ].join("\n"),
                            visibleFacts: ["WS 支持全双工", "Rust 外壳只需对接 /ws", "协议应保留 ask/todo/data/event"],
                            openQuestions: ["是否需要额外 binary protocol？"],
                            taskPlanId: "plan-blackboard-1",
                            blackboardTurnId: "bb-turn-1",
                            createdAt: now,
                            updatedAt: now,
                        },
                    ],
                },
            );

            const latest = memory.listChatHistory({ limit: 1 });
            expect(latest[0]?.taskPlans?.[0]).toMatchObject({
                id: "plan-blackboard-1",
                sourceBlackboardTurnId: "bb-turn-1",
                status: TaskPlanStatus.Done,
            });
            expect(latest[0]?.scenes?.[0]).toMatchObject({
                id: "scene-blackboard-1",
                kind: SceneRecordKind.Blackboard,
                blackboardTurnId: "bb-turn-1",
            });
            expect(latest[0]?.scenes?.[0]?.detail).toContain("decision: 保留 ws，冻结 ask/todo/data/event 协议面");
        } finally {
            memory.dispose();
        }
    });
});

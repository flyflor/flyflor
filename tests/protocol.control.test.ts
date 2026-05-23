import { describe, expect, test } from "bun:test";
import {
    GatewayControlSemanticType,
    GatewayControlErrorCode,
    GatewayControlReplyMetadataKind,
    buildGatewayControlAckPayload,
    buildGatewayControlAskPayload,
    buildGatewayControlCapabilityCatalogPayload,
    buildGatewayControlDataPayload,
    buildGatewayControlErrorPayload,
    buildGatewayControlGatewayStatusPayload,
    buildGatewayControlHistorySnapshotPayload,
    buildGatewayControlPongPayload,
    buildGatewayControlServerHelloSnapshot,
    buildGatewayControlSurfaceCapabilities,
    buildGatewayControlTodoPayload,
    buildGatewayControlTurnDeltaPayload,
    buildGatewayControlTurnErrorPayload,
    buildGatewayControlTurnFinalPayload,
    classifyGatewayControlSemanticType,
    createGatewayControlEnvelope,
    createGatewayControlEventEnvelope,
    normalizeGatewayControlMessage,
    parseGatewayControlEnvelope,
    readGatewayControlHistoryListInput,
    readGatewayControlForkCreateInput,
    readGatewayControlMessageInput,
    readGatewayControlSubscription,
    shouldDeliverGatewayControlEvent,
} from "../src/protocol/control/index.ts";
import {
    CapabilityExecutionKind,
    Channel,
    ChatType,
    GatewayControlMessageType,
    GatewayControlProtocol,
    TaskPlanStatus,
    ToolLifecycleEventType,
} from "../src/protocol/contracts/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType } from "../src/events/index.ts";

describe("Gateway Control protocol", () => {
    test("builds a stable control surface capability snapshot for Rust or other thin clients", () => {
        const capabilities = buildGatewayControlSurfaceCapabilities([
            GatewayControlMessageType.GatewayMessageSend,
            GatewayControlMessageType.EventSubscribe,
            GatewayControlMessageType.GatewayStatusGet,
            GatewayControlMessageType.HistoryList,
        ]);

        expect(capabilities).toEqual({
            commands: [
                GatewayControlMessageType.GatewayMessageSend,
                GatewayControlMessageType.EventSubscribe,
                GatewayControlMessageType.GatewayStatusGet,
                GatewayControlMessageType.HistoryList,
            ],
            eventStream: true,
            protocol: GatewayControlProtocol.WsV1,
            semanticTypes: [
                GatewayControlSemanticType.Input,
                GatewayControlSemanticType.Stream,
                GatewayControlSemanticType.Event,
                GatewayControlSemanticType.Ask,
                GatewayControlSemanticType.Todo,
                GatewayControlSemanticType.Data,
                GatewayControlSemanticType.Error,
                GatewayControlSemanticType.Ping,
                GatewayControlSemanticType.Pong,
            ],
        });
    });

    test("roundtrips a typed ws envelope", () => {
        const envelope = createGatewayControlEnvelope(
            GatewayControlMessageType.GatewayStatusGet,
            { include: "channels" },
            { id: "env-1", requestId: "req-1" },
        );
        const parsed = parseGatewayControlEnvelope(JSON.stringify(envelope));

        expect(parsed).toMatchObject({
            protocol: GatewayControlProtocol.WsV1,
            id: "env-1",
            requestId: "req-1",
            type: GatewayControlMessageType.GatewayStatusGet,
            payload: { include: "channels" },
        });
    });

    test("builds typed control payload snapshots for thin clients and Rust transports", () => {
        expect(buildGatewayControlAckPayload({ received: GatewayControlMessageType.Ping })).toEqual({
            received: GatewayControlMessageType.Ping,
        });
        expect(buildGatewayControlErrorPayload("boom")).toEqual({
            code: GatewayControlErrorCode.Internal,
            details: undefined,
            message: "boom",
            retryable: undefined,
        });
        expect(
            buildGatewayControlErrorPayload("bad payload", {
                code: GatewayControlErrorCode.InvalidPayload,
                details: { field: "text" },
                retryable: false,
            }),
        ).toEqual({
            code: GatewayControlErrorCode.InvalidPayload,
            details: { field: "text" },
            message: "bad payload",
            retryable: false,
        });
        expect(buildGatewayControlTurnDeltaPayload("hel", "msg-1")).toEqual({ delta: "hel", messageId: "msg-1" });
        expect(buildGatewayControlTurnErrorPayload("failed", "msg-1")).toEqual({ message: "failed", messageId: "msg-1" });
        expect(
            buildGatewayControlTurnFinalPayload({
                messageId: "msg-1",
                route: { channel: Channel.Ws, conversationKey: "c-1", chatType: ChatType.Direct },
                text: "done",
                metadata: {
                    kind: GatewayControlReplyMetadataKind.Ask,
                    ask: {
                        choiceCount: 1,
                        choices: [{ label: "Yes" }],
                        executiveToolLoop: {
                            askId: "ask-1",
                            loopGuardReason: "unknown-tool-repeat",
                            message: "Need execution guidance",
                            resume: { mode: "continue" },
                            stepCount: 2,
                            stop: "ask",
                        },
                        freeform: true,
                        prompt: "Need confirmation?",
                        questionCount: 0,
                        questions: [],
                        reason: "other",
                        snapshotId: "snapshot-1",
                    },
                    planning: {
                        contextForks: [{ id: "fork-1", maxContextTokens: 12000, continuitySummary: "scope", title: "Fork" }],
                        replays: [{
                            id: "replay-1",
                            kind: "blackboard",
                            summary: "summary",
                            title: "Replay",
                        }],
                        taskPlans: [{
                            completedStepCount: 0,
                            id: "plan-1",
                            progress: 0,
                            status: "planned",
                            stepCount: 1,
                            steps: [{ id: "step-1", order: 0, status: "planned", title: "Step" }],
                            summary: "Summary",
                            title: "Plan",
                        }],
                    },
                },
            }),
        ).toEqual({
            reply: {
                messageId: "msg-1",
                route: { channel: Channel.Ws, conversationKey: "c-1", chatType: ChatType.Direct },
                text: "done",
                metadata: {
                    kind: GatewayControlReplyMetadataKind.Ask,
                    ask: {
                        choiceCount: 1,
                        choices: [{ label: "Yes" }],
                        executiveToolLoop: {
                            askId: "ask-1",
                            loopGuardReason: "unknown-tool-repeat",
                            message: "Need execution guidance",
                            resume: { mode: "continue" },
                            stepCount: 2,
                            stop: "ask",
                        },
                        freeform: true,
                        prompt: "Need confirmation?",
                        questionCount: 0,
                        questions: [],
                        reason: "other",
                        snapshotId: "snapshot-1",
                    },
                    planning: {
                        contextForks: [{ id: "fork-1", maxContextTokens: 12000, continuitySummary: "scope", title: "Fork" }],
                        replays: [{
                            id: "replay-1",
                            kind: "blackboard",
                            summary: "summary",
                            title: "Replay",
                        }],
                        taskPlans: [{
                            completedStepCount: 0,
                            id: "plan-1",
                            progress: 0,
                            status: "planned",
                            stepCount: 1,
                            steps: [{ id: "step-1", order: 0, status: "planned", title: "Step" }],
                            summary: "Summary",
                            title: "Plan",
                        }],
                    },
                },
            },
        });
        expect(
            buildGatewayControlGatewayStatusPayload({
                channels: [],
                clientCount: 0,
                connectedCount: 0,
                controlState: {
                    activeAsk: {
                        ask: {
                            choiceCount: 1,
                            choices: [{ label: "Continue" }],
                            freeform: true,
                            prompt: "Need confirmation?",
                            questionCount: 0,
                            questions: [],
                            reason: "other",
                            snapshotId: "snapshot-1",
                        },
                        at: "2026-05-19T00:00:00.000Z",
                        messageId: "msg-ask-1",
                        requestId: "req-ask-1",
                        status: "active",
                    },
                    activeFork: {
                        at: "2026-05-19T00:00:00.000Z",
                        id: "fork-1",
                        maxContextTokens: 12000,
                        continuitySummary: "scope",
                        requestId: "req-ask-1",
                        status: "active",
                        title: "Fork",
                    },
                    activeScope: {
                        id: "scope-1",
                        projectDir: "/tmp/scope",
                        projectMemoryDir: "/tmp/scope/.flyflor/memory",
                        title: "Scope",
                    },
                    executiveLoop: {
                        askId: "ask-1",
                        at: "2026-05-19T00:00:00.000Z",
                        requestId: "req-ask-1",
                        status: "paused",
                        stepCount: 2,
                        stop: "ask",
                    },
                },
                degradedCount: 0,
                gatewayRunning: false,
                host: "127.0.0.1",
                port: 7777,
                streamingCount: 0,
            }),
        ).toEqual({
            status: {
                channels: [],
                clientCount: 0,
                connectedCount: 0,
                controlState: {
                    activeAsk: {
                        ask: {
                            choiceCount: 1,
                            choices: [{ label: "Continue" }],
                            freeform: true,
                            prompt: "Need confirmation?",
                            questionCount: 0,
                            questions: [],
                            reason: "other",
                            snapshotId: "snapshot-1",
                        },
                        at: "2026-05-19T00:00:00.000Z",
                        messageId: "msg-ask-1",
                        requestId: "req-ask-1",
                        status: "active",
                    },
                    activeFork: {
                        at: "2026-05-19T00:00:00.000Z",
                        id: "fork-1",
                        maxContextTokens: 12000,
                        continuitySummary: "scope",
                        requestId: "req-ask-1",
                        status: "active",
                        title: "Fork",
                    },
                    activeScope: {
                        id: "scope-1",
                        projectDir: "/tmp/scope",
                        projectMemoryDir: "/tmp/scope/.flyflor/memory",
                        title: "Scope",
                    },
                    executiveLoop: {
                        askId: "ask-1",
                        at: "2026-05-19T00:00:00.000Z",
                        requestId: "req-ask-1",
                        status: "paused",
                        stepCount: 2,
                        stop: "ask",
                    },
                },
                degradedCount: 0,
                gatewayRunning: false,
                host: "127.0.0.1",
                port: 7777,
                streamingCount: 0,
            },
        });
        expect(buildGatewayControlCapabilityCatalogPayload(null)).toEqual({ catalog: null, kits: undefined });
        expect(
            buildGatewayControlHistorySnapshotPayload({
                history: [
                    {
                        assistantText: "Hi",
                        eventId: "event-1",
                        metadata: {
                            executiveToolExecutions: [{
                                capabilityKind: CapabilityExecutionKind.McpTool,
                                key: "workspace.read",
                                ok: true,
                                resultSummary: "kind=text chars=25 preview=approved capability smoke",
                            }],
                            kind: GatewayControlReplyMetadataKind.Reply,
                            messageId: "event-1",
                            planning: {
                                contextForks: [],
                                replays: [],
                                taskPlans: [{
                                    completedStepCount: 0,
                                    id: "plan-1",
                                    progress: 0,
                                    status: TaskPlanStatus.Planned,
                                    stepCount: 1,
                                    steps: [{
                                        id: "step-1",
                                        order: 0,
                                        status: TaskPlanStatus.Planned,
                                        title: "Step",
                                    }],
                                    summary: "Summary",
                                    title: "Plan",
                                }],
                            },
                        },
                        ts: 100,
                        userText: "Hello",
                    },
                ],
                nextBeforeTs: 99,
            }),
        ).toEqual({
            history: [
                {
                    assistantText: "Hi",
                    eventId: "event-1",
                    metadata: {
                        executiveToolExecutions: [{
                            capabilityKind: CapabilityExecutionKind.McpTool,
                            key: "workspace.read",
                            ok: true,
                            resultSummary: "kind=text chars=25 preview=approved capability smoke",
                        }],
                        kind: GatewayControlReplyMetadataKind.Reply,
                        messageId: "event-1",
                        planning: {
                            contextForks: [],
                            replays: [],
                            taskPlans: [{
                                completedStepCount: 0,
                                id: "plan-1",
                                progress: 0,
                                status: TaskPlanStatus.Planned,
                                stepCount: 1,
                                steps: [{
                                    id: "step-1",
                                    order: 0,
                                    status: TaskPlanStatus.Planned,
                                    title: "Step",
                                }],
                                summary: "Summary",
                                title: "Plan",
                            }],
                        },
                    },
                    ts: 100,
                    userText: "Hello",
                },
            ],
            nextBeforeTs: 99,
        });
        expect(buildGatewayControlPongPayload("2026-05-19T00:00:00.000Z")).toEqual({ now: "2026-05-19T00:00:00.000Z" });
        expect(
            buildGatewayControlAskPayload({
                freeform: true,
                prompt: "Need confirmation?",
                reason: "other",
            }),
        ).toEqual({
            ask: {
                freeform: true,
                prompt: "Need confirmation?",
                reason: "other",
            },
        });
        expect(
            buildGatewayControlTodoPayload([
                {
                    completedStepCount: 0,
                    createdAt: "2026-05-19T00:00:00.000Z",
                    id: "plan-1",
                    ownerKey: "scope:todo",
                    sourceKey: "u-1",
                    progress: 0,
                    status: "planned",
                    stepCount: 1,
                    summary: "Summary",
                    title: "Plan",
                    updatedAt: "2026-05-19T00:00:00.000Z",
                },
            ]),
        ).toMatchObject({
            taskPlans: [{ id: "plan-1", title: "Plan" }],
        });
        expect(
            buildGatewayControlDataPayload({
                status: {
                    channels: [],
                    clientCount: 0,
                    connectedCount: 0,
                    degradedCount: 0,
                    gatewayRunning: false,
                    host: "127.0.0.1",
                    port: 7777,
                    streamingCount: 0,
                },
            }),
        ).toMatchObject({
            status: {
                host: "127.0.0.1",
                port: 7777,
            },
        });
        expect(
            buildGatewayControlServerHelloSnapshot({
                capabilities: buildGatewayControlSurfaceCapabilities([GatewayControlMessageType.Ping]),
                clientId: "client-1",
                connectedAt: "2026-05-19T00:00:00.000Z",
                kits: { builtAt: "2026-05-19T00:00:00.000Z", capabilities: [], kits: [], schemaVersion: 1 },
                status: {
                    channels: [],
                    clientCount: 0,
                    connectedCount: 0,
                    degradedCount: 0,
                    gatewayRunning: false,
                    host: "127.0.0.1",
                    port: 7777,
                    streamingCount: 0,
                },
            }),
        ).toMatchObject({
            clientId: "client-1",
            capabilities: {
                commands: [GatewayControlMessageType.Ping],
                semanticTypes: expect.arrayContaining([GatewayControlSemanticType.Stream]),
            },
        });
    });

    test("maps transport messages onto stable semantic lanes for Rust clients", () => {
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.ServerHello)).toBe(
            GatewayControlSemanticType.Data,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.ClientHello)).toBe(
            GatewayControlSemanticType.Data,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.GatewayMessageSend)).toBe(
            GatewayControlSemanticType.Input,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.ForkCreate)).toBe(
            GatewayControlSemanticType.Input,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.TurnDelta)).toBe(
            GatewayControlSemanticType.Stream,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.TurnFinal)).toBe(
            GatewayControlSemanticType.Stream,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.EventPublish)).toBe(
            GatewayControlSemanticType.Event,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.GatewayStatusSnapshot)).toBe(
            GatewayControlSemanticType.Data,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.HistoryList)).toBe(
            GatewayControlSemanticType.Data,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.HistorySnapshot)).toBe(
            GatewayControlSemanticType.Data,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.Error)).toBe(
            GatewayControlSemanticType.Error,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.Ping)).toBe(
            GatewayControlSemanticType.Ping,
        );
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.Pong)).toBe(
            GatewayControlSemanticType.Pong,
        );
    });

    test("keeps server hello as the connection-level bootstrap snapshot", () => {
        const connectedAt = "2026-05-19T00:00:00.000Z";
        const hello = buildGatewayControlServerHelloSnapshot({
            capabilities: buildGatewayControlSurfaceCapabilities([
                GatewayControlMessageType.ClientHello,
                GatewayControlMessageType.GatewayStatusGet,
                GatewayControlMessageType.CapabilityCatalogGet,
                GatewayControlMessageType.Ping,
            ]),
            clientId: "client-1",
            connectedAt,
            kits: {
                builtAt: "2026-05-19T00:00:00.000Z",
                capabilities: [],
                kits: [{
                    id: "builtin.gateway",
                    kind: "gateway",
                    name: "Gateway",
                    permissions: ["control"],
                    schemaVersion: 1,
                    source: "builtin",
                }],
                schemaVersion: 1,
            },
            status: {
                channels: [],
                clientCount: 1,
                connectedCount: 1,
                degradedCount: 0,
                gatewayRunning: true,
                host: "127.0.0.1",
                port: 7777,
                startedAt: "2026-05-19T00:00:00.000Z",
                streamingCount: 0,
                url: "ws://127.0.0.1:7777/ws",
            },
        });

        expect(hello).toMatchObject({
            clientId: "client-1",
            connectedAt,
            status: {
                gatewayRunning: true,
                host: "127.0.0.1",
                port: 7777,
                connectedCount: 1,
                clientCount: 1,
            },
            kits: {
                schemaVersion: 1,
                kits: [{ id: "builtin.gateway" }],
            },
            capabilities: {
                commands: [
                    GatewayControlMessageType.ClientHello,
                    GatewayControlMessageType.GatewayStatusGet,
                    GatewayControlMessageType.CapabilityCatalogGet,
                    GatewayControlMessageType.Ping,
                ],
            },
        });
    });

    test("keeps long-horizon loop snapshot stable on both top-level and ask metadata surfaces", () => {
        const executiveToolLoop = {
            askId: "ask-1",
            loopGuardReason: "unknown-tool-repeat",
            loopGuardSnapshot: {
                callRepeatCounts: {},
                failedCallRepeatCounts: {},
                totalCalls: 2,
                unknownToolCounts: { "missing.tool": 2 },
            },
            message: "Need execution guidance",
            resume: { mode: "continue" as const, requestId: "req-1" },
            stepCount: 2,
            stop: "ask" as const,
            toolBudgetExhausted: true as const,
        };
        const payload = buildGatewayControlTurnFinalPayload({
            messageId: "msg-1",
            route: { channel: Channel.Ws, conversationKey: "c-1", chatType: ChatType.Direct },
            text: "Need confirmation?",
            metadata: {
                kind: GatewayControlReplyMetadataKind.Ask,
                ask: {
                    choiceCount: 1,
                    choices: [{ label: "Yes" }],
                    executiveToolLoop,
                    freeform: true,
                    prompt: "Need confirmation?",
                    questionCount: 0,
                    questions: [],
                    reason: "other",
                    snapshotId: "snapshot-1",
                },
                behaviorSnapshotId: "snapshot-1",
                executiveToolLoop,
                planning: {
                    contextForks: [],
                    replays: [],
                    taskPlans: [],
                },
            },
        });

        expect(payload.reply.metadata?.executiveToolLoop).toEqual(executiveToolLoop);
        expect(payload.reply.metadata?.ask?.executiveToolLoop).toEqual(executiveToolLoop);
    });

    test("documents the stable Rust-facing control lanes and error codes", async () => {
        const doc = await Bun.file(new URL("../docs/control.protocol.md", import.meta.url)).text();

        expect(doc).toContain("最小读取优先级建议");
        expect(doc).toContain("## Snapshot Matrix");
        expect(doc).toContain("Rust 最小接线清单");
        expect(doc).toContain("reply.metadata.executiveToolLoop");
        expect(doc).toContain("reply.metadata.ask");
        expect(doc).toContain("invalid-envelope");
        expect(doc).toContain("invalid-payload");
        expect(doc).toContain("unsupported-message");
    });

    test("rejects unknown control protocol versions", () => {
        expect(() =>
            parseGatewayControlEnvelope(
                JSON.stringify({
                    protocol: "other",
                    id: "env-1",
                    type: GatewayControlMessageType.Ping,
                    at: "2026-05-17T00:00:00.000Z",
                }),
            ),
        ).toThrow("Unsupported gateway control protocol");
    });

    test("rejects invalid message payloads with structured protocol errors", () => {
        expect(() => readGatewayControlMessageInput(undefined)).toThrow("gateway.message.send requires payload");
        expect(() => readGatewayControlForkCreateInput(undefined)).toThrow("fork.create requires payload");
        expect(() => readGatewayControlForkCreateInput({ summary: "s" })).toThrow("fork.create payload requires title");
        expect(() => readGatewayControlForkCreateInput({ title: "Fork" })).toThrow("fork.create payload requires summary");
        expect(() => readGatewayControlHistoryListInput(undefined)).toThrow("history.list requires payload");
        expect(readGatewayControlHistoryListInput({ limit: 10 })).toEqual({ beforeTs: undefined, limit: 10 });
        expect(() => normalizeGatewayControlMessage({ text: "" })).toThrow("gateway.message.send payload requires text");
    });

    test("reads fork.create payload as an explicit control command", () => {
        const input = readGatewayControlForkCreateInput({
            title: "  TUI fork title  ",
            summary: "summary from selected turn",
            continuitySummary: "",
            parentId: "parent-fork",
            scopeId: "scope-1",
            maxContextTokens: 999_999,
            inheritedEventIds: [" source-event-id ", "", 12],
            sourceEventId: "source-event-id",
            sourceAskId: "source-ask-id",
            sourceBlackboardTurnId: "blackboard-turn-id",
            context: {
                contextForkId: "current-active-fork-id",
                activeScope: {
                    id: "scope-1",
                    projectDir: "/tmp/scope",
                    projectMemoryDir: "/tmp/scope/.flyflor/memory",
                    title: "Scope",
                },
            },
        });

        expect(input).toEqual({
            title: "TUI fork title",
            summary: "summary from selected turn",
            continuitySummary: "summary from selected turn",
            parentId: "parent-fork",
            scopeId: "scope-1",
            maxContextTokens: 200_000,
            inheritedEventIds: ["source-event-id"],
            sourceEventId: "source-event-id",
            sourceAskId: "source-ask-id",
            sourceBlackboardTurnId: "blackboard-turn-id",
            id: undefined,
            context: {
                contextForkId: "current-active-fork-id",
                activeScope: {
                    id: "scope-1",
                    projectDir: "/tmp/scope",
                    projectMemoryDir: "/tmp/scope/.flyflor/memory",
                    title: "Scope",
                },
                activeProject: undefined,
            },
        });
    });

    test("normalizes gateway.message.send payload into a ws GatewayMessage", () => {
        const input = readGatewayControlMessageInput({
            conversationKey: "chat-1",
            text: "hello",
            threadId: "thread-1",
            user: { id: "user-1", displayName: "User One" },
        });
        const message = normalizeGatewayControlMessage(input);

        expect(message.route).toMatchObject({
            channel: Channel.Ws,
            conversationKey: "chat-1",
            chatType: ChatType.Direct,
            threadId: "thread-1",
        });
        expect(message.user).toEqual({ id: "user-1", displayName: "User One" });
        expect(message.metadata?.clientMessageId).toBeUndefined();
        expect(message.text).toBe("hello");
    });

    test("does not use payload id as default conversation identity", () => {
        const input = readGatewayControlMessageInput({
            id: "message-1",
            text: "hello",
            user: { id: "user-1" },
        });
        const message = normalizeGatewayControlMessage(input);

        expect(message.id).toBe("message-1");
        expect(message.metadata?.clientMessageId).toBe("message-1");
        expect(message.route.conversationKey).toBe("ws-conversation");
    });

    test("prefers explicit activeScope and keeps activeProject as compatibility input", () => {
        const input = readGatewayControlMessageInput({
            context: {
                activeScope: {
                    id: "scope-1",
                    projectDir: "/tmp/scope",
                    projectMemoryDir: "/tmp/scope/.flyflor/memory",
                    title: "Scope",
                },
                activeProject: {
                    id: "project-1",
                    projectDir: "/tmp/project",
                    projectMemoryDir: "/tmp/project/.flyflor/memory",
                    title: "Project",
                },
                // Thin clients must not rely on core guessing project paths from id-only input.
                activeProjectId: "ignored-project-id",
                contextForkId: "fork-1",
                skillNames: ["review"],
            },
            text: "hello",
        });

        expect(input.context).toEqual({
            activeScope: {
                id: "scope-1",
                projectDir: "/tmp/scope",
                projectMemoryDir: "/tmp/scope/.flyflor/memory",
                title: "Scope",
            },
            activeProject: {
                id: "project-1",
                projectDir: "/tmp/project",
                projectMemoryDir: "/tmp/project/.flyflor/memory",
                title: "Project",
            },
            contextForkId: "fork-1",
            skillNames: ["review"],
        });
    });

    test("roundtrips capability catalog control messages", () => {
        const getEnvelope = createGatewayControlEnvelope(GatewayControlMessageType.CapabilityCatalogGet, undefined, {
            id: "cap-get-1",
        });
        const snapshotEnvelope = createGatewayControlEnvelope(
            GatewayControlMessageType.CapabilityCatalogSnapshot,
            { catalog: null },
            { correlationId: getEnvelope.id, id: "cap-snapshot-1" },
        );

        expect(parseGatewayControlEnvelope(JSON.stringify(getEnvelope))).toMatchObject({
            id: "cap-get-1",
            type: GatewayControlMessageType.CapabilityCatalogGet,
        });
        expect(parseGatewayControlEnvelope(JSON.stringify(snapshotEnvelope))).toMatchObject({
            correlationId: "cap-get-1",
            payload: { catalog: null },
            type: GatewayControlMessageType.CapabilityCatalogSnapshot,
        });
    });

    test("roundtrips history control messages", () => {
        const getEnvelope = createGatewayControlEnvelope(
            GatewayControlMessageType.HistoryList,
            { limit: 2, beforeTs: 100 },
            { id: "history-get-1", requestId: "req-history-1" },
        );
        const snapshotEnvelope = createGatewayControlEnvelope(
            GatewayControlMessageType.HistorySnapshot,
            {
                history: [
                    {
                        assistantText: "Hi",
                        eventId: "event-1",
                        metadata: {
                            executiveToolExecutions: [],
                            kind: GatewayControlReplyMetadataKind.Reply,
                            messageId: "event-1",
                            planning: {
                                contextForks: [],
                                replays: [],
                                taskPlans: [],
                            },
                        },
                        ts: 100,
                        userText: "Hello",
                    },
                ],
                nextBeforeTs: 99,
            },
            { correlationId: getEnvelope.id, id: "history-snapshot-1", requestId: "req-history-1" },
        );

        expect(parseGatewayControlEnvelope(JSON.stringify(getEnvelope))).toMatchObject({
            id: "history-get-1",
            payload: { beforeTs: 100, limit: 2 },
            requestId: "req-history-1",
            type: GatewayControlMessageType.HistoryList,
        });
        expect(parseGatewayControlEnvelope(JSON.stringify(snapshotEnvelope))).toMatchObject({
            correlationId: "history-get-1",
            payload: {
                history: [{
                    eventId: "event-1",
                    metadata: {
                        executiveToolExecutions: [],
                        kind: GatewayControlReplyMetadataKind.Reply,
                        messageId: "event-1",
                        planning: {
                            contextForks: [],
                            replays: [],
                            taskPlans: [],
                        },
                    },
                }],
                nextBeforeTs: 99,
            },
            requestId: "req-history-1",
            type: GatewayControlMessageType.HistorySnapshot,
        });
        expect(readGatewayControlHistoryListInput({ beforeTs: 100, limit: 2 })).toEqual({
            beforeTs: 100,
            limit: 2,
        });
    });

    test("keeps gateway-prefixed wire-v1 compatibility message names stable", () => {
        expect(GatewayControlMessageType.GatewayMessageSend).toBe("gateway.message.send");
        expect(GatewayControlMessageType.GatewayStatusGet).toBe("gateway.status.get");
        expect(GatewayControlMessageType.GatewayStatusSnapshot).toBe("gateway.status.snapshot");
    });

    test("filters event envelopes by explicit subscription", () => {
        const event: RuntimeEvent = {
            type: RuntimeEventType.GatewayMessageReceived,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "req-1",
            payload: { channel: Channel.Ws },
        };
        const eventEnvelope = createGatewayControlEventEnvelope(event);

        expect(eventEnvelope).toMatchObject({
            protocol: GatewayControlProtocol.EventV1,
            requestId: "req-1",
            type: GatewayControlMessageType.EventPublish,
            payload: { event },
        });
        expect(shouldDeliverGatewayControlEvent(event, [{ requestId: "req-1" }])).toBe(true);
        expect(shouldDeliverGatewayControlEvent(event, [{ requestId: "other" }])).toBe(false);
        expect(shouldDeliverGatewayControlEvent(event, [{ types: [RuntimeEventType.GatewayMessageReceived] }])).toBe(
            true,
        );
        expect(shouldDeliverGatewayControlEvent(event, [{ types: [RuntimeEventType.ChannelError] }])).toBe(false);
    });

    test("accepts stable tool lifecycle runtime event subscriptions", () => {
        const subscription = readGatewayControlSubscription({
            types: Object.values(ToolLifecycleEventType),
        });

        expect(subscription).toEqual({
            classes: undefined,
            requestId: undefined,
            types: [
                RuntimeEventType.ToolAskRequired,
                RuntimeEventType.ToolBudgetExhausted,
                RuntimeEventType.ToolFailed,
                RuntimeEventType.ToolOutputPersisted,
                RuntimeEventType.ToolProgress,
                RuntimeEventType.ToolStarted,
                RuntimeEventType.ToolSucceeded,
            ],
        });
    });

    test("rejects unknown event subscription selectors before they enter socket state", () => {
        expect(() => readGatewayControlSubscription({ classes: ["unknown-class"] })).toThrow(
            "event subscription classes must use known runtime event classes",
        );
        try {
            readGatewayControlSubscription({ classes: ["unknown-class"] });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as { code?: string }).code).toBe(GatewayControlErrorCode.InvalidPayload);
            expect((error as { details?: Record<string, unknown> }).details).toEqual({ class: "unknown-class" });
        }

        expect(() => readGatewayControlSubscription({ types: ["runtime.unknown"] })).toThrow(
            "event subscription types must use known runtime event types",
        );
        try {
            readGatewayControlSubscription({ types: ["runtime.unknown"] });
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as { code?: string }).code).toBe(GatewayControlErrorCode.InvalidPayload);
            expect((error as { details?: Record<string, unknown> }).details).toEqual({ type: "runtime.unknown" });
        }
    });
});

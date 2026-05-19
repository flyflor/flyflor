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
    readGatewayControlMessageInput,
    shouldDeliverGatewayControlEvent,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    GatewayControlProtocol,
} from "../src/protocol/contracts/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType } from "../src/events/index.ts";

describe("Gateway Control protocol", () => {
    test("builds a stable control surface capability snapshot for Rust or other thin clients", () => {
        const capabilities = buildGatewayControlSurfaceCapabilities([
            GatewayControlMessageType.GatewayMessageSend,
            GatewayControlMessageType.EventSubscribe,
            GatewayControlMessageType.GatewayStatusGet,
        ]);

        expect(capabilities).toEqual({
            commands: [
                GatewayControlMessageType.GatewayMessageSend,
                GatewayControlMessageType.EventSubscribe,
                GatewayControlMessageType.GatewayStatusGet,
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
                route: { channel: Channel.Ws, chatId: "c-1", chatType: ChatType.Direct },
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
                        contextForks: [{ id: "fork-1", maxContextTokens: 12000, scopeSummary: "scope", title: "Fork" }],
                        scenes: [{
                            id: "scene-1",
                            kind: "blackboard",
                            summary: "summary",
                            title: "Scene",
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
                route: { channel: Channel.Ws, chatId: "c-1", chatType: ChatType.Direct },
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
                        contextForks: [{ id: "fork-1", maxContextTokens: 12000, scopeSummary: "scope", title: "Fork" }],
                        scenes: [{
                            id: "scene-1",
                            kind: "blackboard",
                            summary: "summary",
                            title: "Scene",
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
                connectedCount: 0,
                degradedCount: 0,
                gatewayRunning: false,
                host: "127.0.0.1",
                port: 7777,
                streamingCount: 0,
            }),
        ).toEqual({
            status: {
                channels: [],
                connectedCount: 0,
                degradedCount: 0,
                gatewayRunning: false,
                host: "127.0.0.1",
                port: 7777,
                streamingCount: 0,
            },
        });
        expect(buildGatewayControlCapabilityCatalogPayload(null)).toEqual({ catalog: null, kits: undefined });
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
                    progress: 0,
                    status: "planned",
                    stepCount: 1,
                    summary: "Summary",
                    title: "Plan",
                    updatedAt: "2026-05-19T00:00:00.000Z",
                    userId: "u-1",
                },
            ]),
        ).toMatchObject({
            taskPlans: [{ id: "plan-1", title: "Plan" }],
        });
        expect(
            buildGatewayControlDataPayload({
                status: {
                    channels: [],
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
        expect(classifyGatewayControlSemanticType(GatewayControlMessageType.GatewayMessageSend)).toBe(
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
        expect(() => normalizeGatewayControlMessage({ text: "" })).toThrow("gateway.message.send payload requires text");
    });

    test("normalizes gateway.message.send payload into a ws GatewayMessage", () => {
        const input = readGatewayControlMessageInput({
            chatId: "chat-1",
            text: "hello",
            threadId: "thread-1",
            user: { id: "user-1", displayName: "User One" },
        });
        const message = normalizeGatewayControlMessage(input);

        expect(message.route).toMatchObject({
            channel: Channel.Ws,
            chatId: "chat-1",
            chatType: ChatType.Direct,
            threadId: "thread-1",
        });
        expect(message.user).toEqual({ id: "user-1", displayName: "User One" });
        expect(message.text).toBe("hello");
    });

    test("requires project scope to be fully structured in control payload", () => {
        const input = readGatewayControlMessageInput({
            context: {
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
});

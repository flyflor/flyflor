import {
    Channel,
    ChatType,
    ChannelLinkState,
    ChannelTransport,
    type AgentAsk,
    type AgentAskChoice,
    type AgentAskQuestion,
    type ContextForkRecord,
    GatewayControlMessageType,
    GatewayControlProtocol,
    type GatewayChannelCapabilities,
    type SceneRecord,
    type TaskPlanRecord,
    type TaskPlanStepRecord,
    type RuntimeEventClass,
    type GatewayControlMessageType as GatewayControlMessageTypeValue,
    type GatewayMessage,
    type RuntimeEvent,
} from "../contracts/index.ts";
import { classifyRuntimeEvent } from "../../events/index.ts";
import type { ExternalKitCatalogSnapshot } from "../contracts/index.ts";

export type GatewayControlAckPayload = Record<string, unknown> & {
    clientId?: string;
    received?: string;
    subscriptions?: GatewayControlSubscription[];
};

export const GatewayControlErrorCode = {
    Internal: "internal",
    InvalidEnvelope: "invalid-envelope",
    InvalidPayload: "invalid-payload",
    Unauthorized: "unauthorized",
    UnsupportedMessage: "unsupported-message",
} as const;

export type GatewayControlErrorCode = (typeof GatewayControlErrorCode)[keyof typeof GatewayControlErrorCode];

export class GatewayControlProtocolError extends Error {
    public constructor(
        public readonly code: GatewayControlErrorCode,
        message: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = "GatewayControlProtocolError";
    }
}

export type GatewayControlErrorPayload = Record<string, unknown> & {
    code: GatewayControlErrorCode;
    details?: Record<string, unknown>;
    message: string;
    retryable?: boolean;
};

export type GatewayControlTurnDeltaPayload = Record<string, unknown> & {
    delta: string;
    messageId: string;
};

export type GatewayControlTurnErrorPayload = Record<string, unknown> & {
    message: string;
    messageId: string;
};

export type GatewayControlTurnFinalPayload = Record<string, unknown> & {
    reply: GatewayReplyLike;
};

export type GatewayControlGatewayStatusPayload = Record<string, unknown> & {
    status: GatewayControlGatewayStatusSnapshot;
};

export type GatewayControlCapabilityCatalogPayload = Record<string, unknown> & {
    catalog: Record<string, unknown> | null;
    kits?: ExternalKitCatalogSnapshot;
};

export type GatewayControlServerHelloPayload = Record<string, unknown> & {
    capabilities: GatewayControlSurfaceCapabilities;
    clientId: string;
    connectedAt: string;
    kits: ExternalKitCatalogSnapshot;
    status: GatewayControlGatewayStatusSnapshot;
};

export type GatewayControlPongPayload = Record<string, unknown> & {
    now: string;
};

export type GatewayControlEventPublishPayload = Record<string, unknown> & {
    event: RuntimeEvent;
};

/**
 * Stable Rust-facing WS semantic groups.
 *
 * The transport still carries concrete message types such as `turn.delta` or
 * `event.publish`, but Rust/DIY clients should reason about this smaller set of
 * semantic lanes instead of Bun-specific command names.
 */
export const GatewayControlSemanticType = {
    Ask: "ask",
    Data: "data",
    Error: "error",
    Event: "event",
    Input: "input",
    Ping: "ping",
    Pong: "pong",
    Stream: "stream",
    Todo: "todo",
} as const;

export type GatewayControlSemanticType =
    (typeof GatewayControlSemanticType)[keyof typeof GatewayControlSemanticType];

export type GatewayControlAskPayload = Record<string, unknown> & {
    ask: AgentAsk;
};

export type GatewayControlTodoPayload = Record<string, unknown> & {
    taskPlans: TaskPlanRecord[];
};

export type GatewayControlDataPayload = Record<string, unknown> & {
    channel?: GatewayControlGatewayStatusPayload;
    context?: Record<string, unknown>;
    kits?: ExternalKitCatalogSnapshot;
    status?: GatewayControlGatewayStatusSnapshot;
};

export const GatewayControlReplyMetadataKind = {
    Ask: "ask",
    Reply: "reply",
} as const;

export type GatewayControlReplyMetadataKind =
    (typeof GatewayControlReplyMetadataKind)[keyof typeof GatewayControlReplyMetadataKind];

export interface GatewayControlAskMetadataSnapshot {
    choiceCount: number;
    choices: AgentAskChoice[];
    executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot;
    freeform: boolean;
    prompt: string;
    questionCount: number;
    questions: AgentAskQuestion[];
    reason: AgentAsk["reason"];
    snapshotId: string;
}

export interface GatewayControlTodoStepSnapshot {
    id: string;
    order: number;
    progress?: TaskPlanStepRecord["progress"];
    status: TaskPlanStepRecord["status"];
    title: string;
}

export interface GatewayControlTodoTaskSnapshot {
    completedStepCount: number;
    id: string;
    progress: number;
    status: TaskPlanRecord["status"];
    stepCount: number;
    steps: GatewayControlTodoStepSnapshot[];
    summary: string;
    title: string;
}

export interface GatewayControlContextForkSnapshot {
    id: string;
    maxContextTokens: ContextForkRecord["maxContextTokens"];
    scopeSummary: ContextForkRecord["scopeSummary"];
    title: ContextForkRecord["title"];
}

export interface GatewayControlSceneSnapshot {
    blackboardTurnId?: SceneRecord["blackboardTurnId"];
    contextForkId?: SceneRecord["contextForkId"];
    id: string;
    kind: SceneRecord["kind"];
    summary: SceneRecord["summary"];
    taskPlanId?: SceneRecord["taskPlanId"];
    title: SceneRecord["title"];
}

export interface GatewayControlPlanningMetadataSnapshot {
    contextForks: GatewayControlContextForkSnapshot[];
    scenes: GatewayControlSceneSnapshot[];
    taskPlans: GatewayControlTodoTaskSnapshot[];
}

export interface GatewayControlLongHorizonLoopSnapshot {
    askId: string;
    loopGuardReason?: string;
    message: string;
    resume: {
        mode: "continue";
        requestId?: string;
    };
    stepCount: number;
    stop: "ask";
    toolBudgetExhausted?: true;
}

export type GatewayControlReplyMetadata = Record<string, unknown> & {
    ask?: GatewayControlAskMetadataSnapshot;
    behaviorSnapshotId?: string;
    executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot;
    kind?: GatewayControlReplyMetadataKind;
    planning?: GatewayControlPlanningMetadataSnapshot;
};

export interface GatewayReplyLike {
    messageId: string;
    route: GatewayMessage["route"];
    text: string;
    delivery?: GatewayMessage["metadata"] | Record<string, unknown>;
    metadata?: GatewayControlReplyMetadata;
}

export interface GatewayControlChannelStatusSnapshot {
    adapter: string | null;
    configured: boolean;
    connected: boolean;
    detail?: string;
    implemented: boolean;
    lastError?: string;
    lastErrorAt?: string;
    lastInboundAt?: string;
    lastOutboundAt?: string;
    name: string;
    state: ChannelLinkState;
    streaming: boolean;
    transport: ChannelTransport;
    capabilities?: GatewayChannelCapabilities;
}

export interface GatewayControlGatewayStatusSnapshot {
    channels: GatewayControlChannelStatusSnapshot[];
    connectedCount: number;
    degradedCount: number;
    gatewayRunning: boolean;
    host: string;
    port: number;
    startedAt?: string;
    streamingCount: number;
    uptimeMs?: number;
    url?: string;
}

export interface GatewayControlEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    protocol: typeof GatewayControlProtocol.WsV1;
    id: string;
    type: GatewayControlMessageTypeValue;
    at: string;
    requestId?: string;
    correlationId?: string;
    payload?: TPayload;
}

export interface GatewayControlEventEnvelope {
    protocol: typeof GatewayControlProtocol.EventV1;
    id: string;
    type: typeof GatewayControlMessageType.EventPublish;
    at: string;
    requestId?: string;
    payload: GatewayControlEventPublishPayload;
}

export interface GatewayControlSubscription {
    classes?: RuntimeEventClass[];
    requestId?: string;
    types?: string[];
}

export interface GatewayControlClientHello {
    capabilities?: Record<string, unknown>;
    clientId?: string;
    name?: string;
    version?: string;
}

export interface GatewayControlMessageInput {
    attachments?: GatewayMessage["attachments"];
    chatId?: string;
    chatType?: GatewayMessage["route"]["chatType"];
    context?: {
        activeProject?: GatewayControlProjectScope;
        contextForkId?: string;
        skillNames?: string[];
    };
    id?: string;
    metadata?: Record<string, unknown>;
    text: string;
    threadId?: string;
    user?: {
        displayName?: string;
        id?: string;
    };
}

export interface GatewayControlProjectScope {
    id: string;
    projectDir: string;
    projectMemoryDir: string;
    title?: string;
}

export interface GatewayControlSurfaceCapabilities {
    commands: string[];
    eventStream: true;
    protocol: typeof GatewayControlProtocol.WsV1;
    semanticTypes: GatewayControlSemanticType[];
}

export type GatewayControlSocket = Bun.ServerWebSocket<GatewayControlPeer>;

export interface GatewayControlPeer {
    clientId: string;
    connectedAt: string;
    subscriptions: GatewayControlSubscription[];
}

export function createGatewayControlEnvelope<TPayload extends Record<string, unknown>>(
    type: GatewayControlMessageTypeValue,
    payload?: TPayload,
    options: { correlationId?: string; id?: string; requestId?: string } = {},
): GatewayControlEnvelope<TPayload> {
    return {
        protocol: GatewayControlProtocol.WsV1,
        id: options.id ?? crypto.randomUUID(),
        type,
        at: new Date().toISOString(),
        requestId: options.requestId,
        correlationId: options.correlationId,
        payload,
    };
}

export function createGatewayControlEventEnvelope(event: RuntimeEvent): GatewayControlEventEnvelope {
    return {
        protocol: GatewayControlProtocol.EventV1,
        id: crypto.randomUUID(),
        type: GatewayControlMessageType.EventPublish,
        at: new Date().toISOString(),
        requestId: event.requestId,
        payload: { event },
    };
}

export function buildGatewayControlAckPayload(input: GatewayControlAckPayload): GatewayControlAckPayload {
    return input;
}

export function buildGatewayControlErrorPayload(
    message: string,
    options: {
        code?: GatewayControlErrorCode;
        details?: Record<string, unknown>;
        retryable?: boolean;
    } = {},
): GatewayControlErrorPayload {
    return {
        code: options.code ?? GatewayControlErrorCode.Internal,
        details: options.details,
        message,
        retryable: options.retryable,
    };
}

export function buildGatewayControlTurnDeltaPayload(delta: string, messageId: string): GatewayControlTurnDeltaPayload {
    return { delta, messageId };
}

export function buildGatewayControlTurnErrorPayload(
    message: string,
    messageId: string,
): GatewayControlTurnErrorPayload {
    return { message, messageId };
}

export function buildGatewayControlTurnFinalPayload(reply: GatewayReplyLike): GatewayControlTurnFinalPayload {
    return { reply };
}

export function buildGatewayControlGatewayStatusPayload(
    status: GatewayControlGatewayStatusSnapshot,
): GatewayControlGatewayStatusPayload {
    return { status };
}

export function buildGatewayControlCapabilityCatalogPayload(
    catalog: Record<string, unknown> | null,
    kits?: ExternalKitCatalogSnapshot,
): GatewayControlCapabilityCatalogPayload {
    return { catalog, kits };
}

export function buildGatewayControlServerHelloPayload(input: GatewayControlServerHelloPayload): GatewayControlServerHelloPayload {
    return input;
}

export function buildGatewayControlPongPayload(now = new Date().toISOString()): GatewayControlPongPayload {
    return { now };
}

export function buildGatewayControlAskPayload(ask: AgentAsk): GatewayControlAskPayload {
    return { ask };
}

export function buildGatewayControlTodoPayload(taskPlans: TaskPlanRecord[]): GatewayControlTodoPayload {
    return { taskPlans };
}

export function buildGatewayControlDataPayload(input: GatewayControlDataPayload): GatewayControlDataPayload {
    return input;
}

/**
 * Maps concrete transport message types to the smaller stable semantic lane set.
 *
 * Rust or DIY clients should branch on this lane first, then optionally inspect
 * the concrete message type when they need finer transport-specific handling.
 */
export function classifyGatewayControlSemanticType(
    type: GatewayControlMessageTypeValue,
): GatewayControlSemanticType {
    switch (type) {
        case GatewayControlMessageType.GatewayMessageSend:
            return GatewayControlSemanticType.Input;
        case GatewayControlMessageType.TurnDelta:
        case GatewayControlMessageType.TurnFinal:
        case GatewayControlMessageType.TurnError:
            return GatewayControlSemanticType.Stream;
        case GatewayControlMessageType.EventPublish:
        case GatewayControlMessageType.EventSubscribe:
        case GatewayControlMessageType.EventUnsubscribe:
            return GatewayControlSemanticType.Event;
        case GatewayControlMessageType.Error:
            return GatewayControlSemanticType.Error;
        case GatewayControlMessageType.Ping:
            return GatewayControlSemanticType.Ping;
        case GatewayControlMessageType.Pong:
            return GatewayControlSemanticType.Pong;
        case GatewayControlMessageType.Ack:
        case GatewayControlMessageType.CapabilityCatalogGet:
        case GatewayControlMessageType.CapabilityCatalogSnapshot:
        case GatewayControlMessageType.ClientHello:
        case GatewayControlMessageType.GatewayStatusGet:
        case GatewayControlMessageType.GatewayStatusSnapshot:
        case GatewayControlMessageType.ServerHello:
            return GatewayControlSemanticType.Data;
    }
}

export function parseGatewayControlEnvelope(input: string | Buffer): GatewayControlEnvelope {
    const raw = typeof input === "string" ? input : input.toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidEnvelope,
            "Gateway control envelope must be a JSON object",
        );
    }
    if (parsed.protocol !== GatewayControlProtocol.WsV1) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidEnvelope,
            "Unsupported gateway control protocol",
            { protocol: parsed.protocol as string | undefined },
        );
    }
    const id = readString(parsed.id);
    const type = readString(parsed.type) as GatewayControlMessageTypeValue | undefined;
    const at = readString(parsed.at);
    if (!id || !type || !at) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidEnvelope,
            "Gateway control envelope requires id, type and at",
        );
    }
    return {
        protocol: GatewayControlProtocol.WsV1,
        id,
        type,
        at,
        requestId: readString(parsed.requestId),
        correlationId: readString(parsed.correlationId),
        payload: isRecord(parsed.payload) ? parsed.payload : undefined,
    };
}

export function normalizeGatewayControlMessage(input: GatewayControlMessageInput): GatewayMessage {
    if (!input.text || typeof input.text !== "string") {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "gateway.message.send payload requires text",
        );
    }
    const userId = input.user?.id ?? "ws-user";
    return {
        id: input.id ?? crypto.randomUUID(),
        route: {
            channel: Channel.Ws,
            chatId: input.chatId ?? userId,
            chatType: input.chatType ?? ChatType.Direct,
            threadId: input.threadId,
        },
        user: {
            id: userId,
            displayName: input.user?.displayName,
        },
        text: input.text,
        attachments: input.attachments,
        metadata: input.metadata,
        receivedAt: new Date().toISOString(),
    };
}

export function readGatewayControlSubscription(payload: Record<string, unknown> | undefined): GatewayControlSubscription {
    return {
        classes: Array.isArray(payload?.classes)
            ? payload.classes.filter((item): item is RuntimeEventClass => typeof item === "string")
            : undefined,
        requestId: readString(payload?.requestId),
        types: Array.isArray(payload?.types) ? payload.types.filter((item): item is string => typeof item === "string") : undefined,
    };
}

export function readGatewayControlMessageInput(payload: Record<string, unknown> | undefined): GatewayControlMessageInput {
    if (!payload) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "gateway.message.send requires payload",
        );
    }
    return {
        id: readString(payload.id),
        text: readString(payload.text) ?? "",
        chatId: readString(payload.chatId),
        chatType: readString(payload.chatType) as GatewayControlMessageInput["chatType"],
        threadId: readString(payload.threadId),
        user: isRecord(payload.user)
            ? {
                  id: readString(payload.user.id),
                  displayName: readString(payload.user.displayName),
              }
            : undefined,
        context: isRecord(payload.context)
            ? {
                  activeProject: readGatewayControlProjectScope(payload.context.activeProject),
                  contextForkId: readString(payload.context.contextForkId),
                  skillNames: Array.isArray(payload.context.skillNames)
                      ? payload.context.skillNames.filter((item): item is string => typeof item === "string")
                      : undefined,
              }
            : undefined,
        attachments: Array.isArray(payload.attachments) ? payload.attachments as GatewayMessage["attachments"] : undefined,
        metadata: isRecord(payload.metadata) ? payload.metadata : undefined,
    };
}

function readGatewayControlProjectScope(value: unknown): GatewayControlProjectScope | undefined {
    if (!isRecord(value)) return undefined;
    const id = readString(value.id);
    const projectDir = readString(value.projectDir);
    const projectMemoryDir = readString(value.projectMemoryDir);
    if (!id || !projectDir || !projectMemoryDir) return undefined;
    return {
        id,
        projectDir,
        projectMemoryDir,
        title: readString(value.title),
    };
}

export function shouldDeliverGatewayControlEvent(
    event: RuntimeEvent,
    subscriptions: GatewayControlSubscription[],
): boolean {
    if (subscriptions.length === 0) return false;
    return subscriptions.some((subscription) => {
        if (subscription.requestId && subscription.requestId !== event.requestId) return false;
        if (subscription.types && subscription.types.length > 0 && !subscription.types.includes(event.type)) return false;
        if (
            subscription.classes &&
            subscription.classes.length > 0 &&
            !subscription.classes.includes(classifyRuntimeEvent(event.type))
        ) {
            return false;
        }
        return true;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

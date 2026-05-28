import {
    Channel,
    ChatType,
    ChannelLinkState,
    ChannelTransport,
    ControlSnapshotStatus,
    type AgentAsk,
    type AgentAskChoice,
    type AgentAskQuestion,
    type CapabilityExecutionKind,
    type ContextForkRecord,
    GatewayControlMessageType,
    GatewayControlProtocol,
    type GatewayChannelCapabilities,
    type ReplayRecord,
    type TaskPlanRecord,
    type TaskPlanStepRecord,
    RuntimeEventClass,
    type GatewayControlMessageType as GatewayControlMessageTypeValue,
    type GatewayMessage,
    type RuntimeEvent,
    TaskPlanDecisionAction,
    type TaskPlanDecisionAction as TaskPlanDecisionActionType,
} from "../contracts/index.ts";
import { classifyRuntimeEvent, RuntimeEventType } from "../../events/index.ts";
import type { ExecutionJobSnapshot } from "../../executive/job/index.ts";
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

export interface GatewayControlMessageInterruptInput {
    messageId?: string;
    requestId?: string;
}

export type GatewayControlMessageInterruptPayload = Record<string, unknown> & GatewayControlMessageInterruptInput;

export interface GatewayControlMessageUndoInput {
    anchorEventId?: string;
    anchorMessageId?: string;
    reason?: string;
    turnIndex?: number;
}

export type GatewayControlMessageUndoPayload = Record<string, unknown> & GatewayControlMessageUndoInput;

export type GatewayControlTurnFinalPayload = Record<string, unknown> & {
    reply: GatewayReplyLike;
};

export type GatewayControlGatewayStatusPayload = Record<string, unknown> & {
    cache?: GatewayControlReadCacheMetadata;
    status: GatewayControlGatewayStatusSnapshot;
};

export type GatewayControlCapabilityCatalogPayload = Record<string, unknown> & {
    catalog: Record<string, unknown> | null;
    kits?: ExternalKitCatalogSnapshot;
};

export interface GatewayControlHistoryListInput {
    beforeTs?: number;
    contextForkId?: string;
    limit?: number;
}

export type GatewayControlHistoryListPayload = Record<string, unknown> & GatewayControlHistoryListInput;

export interface GatewayControlHistoryTurnSnapshot {
    assistantText: string;
    eventId: string;
    contextForks?: ContextForkRecord[];
    executiveToolExecutions?: GatewayControlExecutiveToolExecutionSnapshot[];
    replays?: ReplayRecord[];
    taskPlans?: TaskPlanRecord[];
    /**
     * Control-local replay metadata mirrors `turn.final.reply.metadata` so thin
     * clients can render historic execution/planning state without importing
     * runtime internals or promoting this shape into brain contracts.
     */
    metadata?: GatewayControlReplyMetadata;
    ts: number;
    userText: string;
}

export type GatewayControlHistorySnapshotPayload = Record<string, unknown> & {
    cache?: GatewayControlReadCacheMetadata;
    history: GatewayControlHistoryTurnSnapshot[];
    nextBeforeTs?: number;
};

export type GatewayControlQuerySnapshotPayload = Record<string, unknown> & {
    cache?: GatewayControlReadCacheMetadata;
    data: unknown;
};

export interface GatewayControlReadCacheMetadata {
    hit: boolean;
    key: string;
    ttlMs: number;
}

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
    continuitySummary: ContextForkRecord["continuitySummary"];
    title: ContextForkRecord["title"];
}

export interface GatewayControlReplaySnapshot {
    blackboardTurnId?: ReplayRecord["blackboardTurnId"];
    contextForkId?: ReplayRecord["contextForkId"];
    id: string;
    kind: ReplayRecord["kind"];
    summary: ReplayRecord["summary"];
    taskPlanId?: ReplayRecord["taskPlanId"];
    title: ReplayRecord["title"];
}

export interface GatewayControlPlanningMetadataSnapshot {
    contextForks: GatewayControlContextForkSnapshot[];
    replays: GatewayControlReplaySnapshot[];
    taskPlans: GatewayControlTodoTaskSnapshot[];
}

export interface GatewayControlExecutiveToolExecutionSnapshot {
    capabilityKind: CapabilityExecutionKind;
    error?: string;
    key: string;
    ok: boolean;
    resultSummary?: string;
}

export interface GatewayControlExecutiveLoopGuardSnapshot {
    callRepeatCounts: Record<string, number>;
    failedCallRepeatCounts: Record<string, number>;
    totalCalls: number;
    unknownToolCounts: Record<string, number>;
}

export interface GatewayControlLongHorizonLoopSnapshot {
    ask?: import("../contracts/index.ts").AgentAsk;
    askId: string;
    job?: ExecutionJobSnapshot;
    jobId?: string;
    loopGuardReason?: string;
    loopGuardSnapshot?: GatewayControlExecutiveLoopGuardSnapshot;
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
    executiveToolExecutions?: GatewayControlExecutiveToolExecutionSnapshot[];
    executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot;
    kind?: GatewayControlReplyMetadataKind;
    messageId?: string;
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
    cache?: GatewayControlReadCacheStatusSnapshot;
    channels: GatewayControlChannelStatusSnapshot[];
    clientCount?: number;
    connectedCount: number;
    context?: GatewayControlContextTelemetrySnapshot;
    controlState?: GatewayControlStateSnapshot;
    degradedCount: number;
    gatewayRunning: boolean;
    host: string;
    model?: GatewayControlModelStatusSnapshot;
    port: number;
    startedAt?: string;
    streamingCount: number;
    uptimeMs?: number;
    url?: string;
}

export interface GatewayControlModelStatusSnapshot {
    contextStatus: "available" | "unknown";
    contextUsedTokens: number | null;
    contextWindowTokens: number | null;
    contextWindowPercent: number | null;
    currentTokens: number | null;
    maxOutputTokens: number;
    model: string;
    provider: string;
    providerId: string;
}

export interface GatewayControlContextTelemetrySnapshot {
    compressionThresholdTokens: number | null;
    contextStatus: "available" | "unknown";
    contextUsedTokens: number | null;
    contextWindowPercent: number | null;
    currentTokens: number | null;
    hotContextTokens: number | null;
    remainingContextTokens: number | null;
}

export interface GatewayControlReadCacheStatusSnapshot {
    entries: number;
    hits: number;
    invalidations: number;
    misses: number;
    ttlMs: number;
}

export interface GatewayControlScopeSnapshot {
    id: string;
    projectDir: string;
    projectMemoryDir: string;
    title?: string;
}

export interface GatewayControlActiveAskSnapshot {
    ask: GatewayControlAskMetadataSnapshot;
    at: string;
    messageId: string;
    requestId?: string;
    status: typeof ControlSnapshotStatus.Active | typeof ControlSnapshotStatus.Resumed;
}

export interface GatewayControlActiveForkSnapshot extends GatewayControlContextForkSnapshot {
    at: string;
    requestId?: string;
    status: typeof ControlSnapshotStatus.Active;
}

export interface GatewayControlExecutiveLoopStateSnapshot {
    askId?: GatewayControlLongHorizonLoopSnapshot["askId"];
    at: string;
    loopGuardReason?: GatewayControlLongHorizonLoopSnapshot["loopGuardReason"];
    loopGuardSnapshot?: GatewayControlLongHorizonLoopSnapshot["loopGuardSnapshot"];
    message?: GatewayControlLongHorizonLoopSnapshot["message"];
    requestId?: string;
    resume?: GatewayControlLongHorizonLoopSnapshot["resume"];
    status: typeof ControlSnapshotStatus.Paused | typeof ControlSnapshotStatus.Resumed;
    stepCount?: GatewayControlLongHorizonLoopSnapshot["stepCount"];
    stop?: GatewayControlLongHorizonLoopSnapshot["stop"];
    toolBudgetExhausted?: GatewayControlLongHorizonLoopSnapshot["toolBudgetExhausted"];
}

export interface GatewayControlStateSnapshot {
    activeAsk?: GatewayControlActiveAskSnapshot;
    activeFork?: GatewayControlActiveForkSnapshot;
    activeScope?: GatewayControlScopeSnapshot;
    executiveLoop?: GatewayControlExecutiveLoopStateSnapshot;
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

const VALID_RUNTIME_EVENT_CLASSES = new Set<string>(Object.values(RuntimeEventClass));
const VALID_RUNTIME_EVENT_TYPES = new Set<string>(Object.values(RuntimeEventType));

export interface GatewayControlMessageInput {
    attachments?: GatewayMessage["attachments"];
    /** Routing/audit/dedup provenance only; never a Scope, session, or memory owner. */
    conversationKey?: string;
    chatType?: GatewayMessage["route"]["chatType"];
    /** Explicit context assembly entry. The socket layer never infers this from peer/user/thread fields. */
    context?: {
        activeScope?: GatewayControlProjectScope;
        activeProject?: GatewayControlProjectScope;
        contextForkId?: string;
        skillNames?: string[];
        toolApprovals?: GatewayControlToolApprovals;
    };
    id?: string;
    metadata?: Record<string, unknown>;
    text: string;
    /** Platform lane/reply anchor only; not cognitive continuity. */
    threadId?: string;
    user?: {
        displayName?: string;
        /** External actor provenance only; not cognitive continuity. */
        id?: string;
    };
}

export interface GatewayControlForkCreateInput {
    context?: {
        activeScope?: GatewayControlProjectScope;
        activeProject?: GatewayControlProjectScope;
        contextForkId?: string;
    };
    continuitySummary: string;
    id?: string;
    inheritedEventIds: string[];
    maxContextTokens: number;
    parentId?: string;
    scopeId?: string;
    sourceAskId?: string;
    sourceBlackboardTurnId?: string;
    sourceEventId?: string;
    summary: string;
    title: string;
}

export interface GatewayControlTaskPlanDecideInput {
    action: TaskPlanDecisionActionType;
    planId: string;
    revision?: string;
}

export interface GatewayControlToolApprovals {
    mcpToolCalls?: boolean;
    userToolCalls?: boolean;
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
    /** Live transport peer id only. It is not a user/session/chat continuity owner. */
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
    cache?: GatewayControlReadCacheMetadata,
): GatewayControlGatewayStatusPayload {
    return { cache, status };
}

export function buildGatewayControlCapabilityCatalogPayload(
    catalog: Record<string, unknown> | null,
    kits?: ExternalKitCatalogSnapshot,
): GatewayControlCapabilityCatalogPayload {
    return { catalog, kits };
}

export function buildGatewayControlHistorySnapshotPayload(input: {
    cache?: GatewayControlReadCacheMetadata;
    history: GatewayControlHistoryTurnSnapshot[];
    nextBeforeTs?: number;
}): GatewayControlHistorySnapshotPayload {
    return input;
}

export function buildGatewayControlQuerySnapshotPayload(
    data: unknown,
    cache?: GatewayControlReadCacheMetadata,
): GatewayControlQuerySnapshotPayload {
    return { cache, data };
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
        case GatewayControlMessageType.GatewayMessageInterrupt:
        case GatewayControlMessageType.GatewayMessageUndo:
        case GatewayControlMessageType.ForkCreate:
        case GatewayControlMessageType.TaskPlanDecide:
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
        case GatewayControlMessageType.ConfirmDetailGet:
        case GatewayControlMessageType.ConfirmList:
        case GatewayControlMessageType.ConfirmSnapshot:
        case GatewayControlMessageType.ExecutionJobDetailGet:
        case GatewayControlMessageType.ExecutionJobList:
        case GatewayControlMessageType.ExecutionJobSnapshot:
        case GatewayControlMessageType.GatewayStatusGet:
        case GatewayControlMessageType.GatewayStatusSnapshot:
        case GatewayControlMessageType.AskDetailGet:
        case GatewayControlMessageType.AskList:
        case GatewayControlMessageType.AskSnapshot:
        case GatewayControlMessageType.BlackboardDetailGet:
        case GatewayControlMessageType.BlackboardList:
        case GatewayControlMessageType.BlackboardSnapshot:
        case GatewayControlMessageType.CrystalList:
        case GatewayControlMessageType.CrystalSnapshot:
        case GatewayControlMessageType.ForkDetailGet:
        case GatewayControlMessageType.ForkList:
        case GatewayControlMessageType.ForkMemoryGet:
        case GatewayControlMessageType.ForkMemorySnapshot:
        case GatewayControlMessageType.ForkSnapshot:
        case GatewayControlMessageType.HistoryDetailGet:
        case GatewayControlMessageType.HistoryList:
        case GatewayControlMessageType.HistorySnapshot:
        case GatewayControlMessageType.ReplayDetailGet:
        case GatewayControlMessageType.ReplayList:
        case GatewayControlMessageType.ReplaySnapshot:
        case GatewayControlMessageType.ScopeDetailGet:
        case GatewayControlMessageType.ScopeList:
        case GatewayControlMessageType.ScopeSnapshot:
        case GatewayControlMessageType.ServerHello:
        case GatewayControlMessageType.TaskDetailGet:
        case GatewayControlMessageType.TaskList:
        case GatewayControlMessageType.TaskSnapshot:
        case GatewayControlMessageType.ThoughtDetailGet:
        case GatewayControlMessageType.ThoughtSnapshot:
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
    const actorId = input.user?.id ?? "ws-actor";
    const messageId = input.id ?? crypto.randomUUID();
    return {
        id: messageId,
        route: {
            channel: Channel.Ws,
            conversationKey: input.conversationKey ?? "ws-conversation",
            chatType: input.chatType ?? ChatType.Direct,
            threadId: input.threadId,
        },
        user: {
            id: actorId,
            displayName: input.user?.displayName,
        },
        text: input.text,
        attachments: input.attachments,
        metadata: {
            ...(input.metadata ?? {}),
            clientMessageId: input.id,
        },
        receivedAt: new Date().toISOString(),
    };
}

export function readGatewayControlSubscription(payload: Record<string, unknown> | undefined): GatewayControlSubscription {
    return {
        classes: Array.isArray(payload?.classes)
            ? payload.classes.map((item) => readRuntimeEventClass(item))
            : undefined,
        requestId: readString(payload?.requestId),
        // Event subscriptions are protocol selectors, so unknown classes/types
        // are rejected instead of being silently persisted as inert filters.
        types: Array.isArray(payload?.types) ? payload.types.map((item) => readRuntimeEventType(item)) : undefined,
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
        conversationKey: readString(payload.conversationKey),
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
                  activeScope: readGatewayControlProjectScope(payload.context.activeScope),
                  activeProject: readGatewayControlProjectScope(payload.context.activeProject),
                  contextForkId: readString(payload.context.contextForkId),
                  skillNames: Array.isArray(payload.context.skillNames)
                      ? payload.context.skillNames.filter((item): item is string => typeof item === "string")
                      : undefined,
                  toolApprovals: readGatewayControlToolApprovals(payload.context.toolApprovals),
              }
            : undefined,
        attachments: Array.isArray(payload.attachments) ? payload.attachments as GatewayMessage["attachments"] : undefined,
        metadata: isRecord(payload.metadata) ? payload.metadata : undefined,
    };
}

export function readGatewayControlMessageInterruptInput(
    payload: Record<string, unknown> | undefined,
): GatewayControlMessageInterruptInput {
    return {
        messageId: readString(payload?.messageId),
        requestId: readString(payload?.requestId),
    };
}

export function readGatewayControlMessageUndoInput(
    payload: Record<string, unknown> | undefined,
): GatewayControlMessageUndoInput {
    return {
        anchorEventId: readTrimmedString(payload?.anchorEventId, 160),
        anchorMessageId: readTrimmedString(payload?.anchorMessageId, 160),
        reason: readTrimmedString(payload?.reason, 600),
        turnIndex: readNumber(payload?.turnIndex),
    };
}

export function readGatewayControlForkCreateInput(
    payload: Record<string, unknown> | undefined,
): GatewayControlForkCreateInput {
    if (!payload) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "fork.create requires payload",
        );
    }
    const title = readRequiredTrimmedString(payload.title, "fork.create payload requires title", 160);
    const summary = readRequiredTrimmedString(payload.summary, "fork.create payload requires summary", 1200);
    const continuitySummary = readTrimmedString(payload.continuitySummary, 1200) ?? summary;
    const context = isRecord(payload.context)
        ? {
              activeScope: readGatewayControlProjectScope(payload.context.activeScope),
              activeProject: readGatewayControlProjectScope(payload.context.activeProject),
              contextForkId: readTrimmedString(payload.context.contextForkId, 120),
          }
        : undefined;
    return {
        context,
        continuitySummary,
        id: readTrimmedString(payload.id, 120),
        inheritedEventIds: readStringArray(payload.inheritedEventIds, 64, 120),
        maxContextTokens: clampInteger(readNumber(payload.maxContextTokens) ?? 12_000, 1_000, 200_000),
        parentId: readTrimmedString(payload.parentId, 120),
        scopeId: readTrimmedString(payload.scopeId, 120),
        sourceAskId: readTrimmedString(payload.sourceAskId, 120),
        sourceBlackboardTurnId: readTrimmedString(payload.sourceBlackboardTurnId, 120),
        sourceEventId: readTrimmedString(payload.sourceEventId, 120),
        summary,
        title,
    };
}

export function readGatewayControlTaskPlanDecideInput(
    payload: Record<string, unknown> | undefined,
): GatewayControlTaskPlanDecideInput {
    if (!payload) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "task.plan.decide requires payload",
        );
    }
    const planId = readRequiredTrimmedString(payload.planId, "task.plan.decide payload requires planId", 160);
    const action = readTaskPlanDecisionAction(payload.action);
    if (!action) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "task.plan.decide payload requires action confirm|revise|abandon",
        );
    }
    return {
        action,
        planId,
        revision: readTrimmedString(payload.revision, 2000),
    };
}

function readGatewayControlToolApprovals(value: unknown): GatewayControlToolApprovals | undefined {
    if (!isRecord(value)) return undefined;
    return {
        mcpToolCalls: value.mcpToolCalls === true,
        userToolCalls: value.userToolCalls === true,
    };
}

export function readGatewayControlHistoryListInput(
    payload: Record<string, unknown> | undefined,
): GatewayControlHistoryListInput {
    // history.list is a brain.db ledger query/replay. It deliberately has no
    // sourceKey, user, session, Scope, or handshake filter and never
    // participates in prompt/context assembly. A contextForkId may narrow the
    // visible replay to one explicit fork ledger.
    if (!payload) {
        throw new GatewayControlProtocolError(
            GatewayControlErrorCode.InvalidPayload,
            "history.list requires payload",
        );
    }
    const beforeTs = readNumber(payload.beforeTs);
    const contextForkId = readTrimmedString(payload.contextForkId, 120);
    const limit = readNumber(payload.limit);
    return {
        beforeTs,
        contextForkId,
        limit,
    };
}

export function readGatewayControlQueryPayload(
    payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
    return payload ?? {};
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

function readRuntimeEventClass(value: unknown): RuntimeEventClass {
    if (typeof value === "string" && VALID_RUNTIME_EVENT_CLASSES.has(value)) {
        return value as RuntimeEventClass;
    }
    throw new GatewayControlProtocolError(
        GatewayControlErrorCode.InvalidPayload,
        "event subscription classes must use known runtime event classes",
        { class: typeof value === "string" ? value : undefined },
    );
}

function readRuntimeEventType(value: unknown): string {
    if (typeof value === "string" && VALID_RUNTIME_EVENT_TYPES.has(value)) {
        return value;
    }
    throw new GatewayControlProtocolError(
        GatewayControlErrorCode.InvalidPayload,
        "event subscription types must use known runtime event types",
        { type: typeof value === "string" ? value : undefined },
    );
}

function readTaskPlanDecisionAction(value: unknown): TaskPlanDecisionActionType | undefined {
    return (
        value === TaskPlanDecisionAction.Confirm ||
        value === TaskPlanDecisionAction.Revise ||
        value === TaskPlanDecisionAction.Abandon
    )
        ? value
        : undefined;
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

function readTrimmedString(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
}

function readRequiredTrimmedString(value: unknown, message: string, maxLength: number): string {
    const read = readTrimmedString(value, maxLength);
    if (!read) {
        throw new GatewayControlProtocolError(GatewayControlErrorCode.InvalidPayload, message);
    }
    return read;
}

function readStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => readTrimmedString(item, maxLength))
        .filter((item): item is string => Boolean(item))
        .slice(0, maxItems);
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
    const integer = Math.floor(value);
    if (integer < min) return min;
    if (integer > max) return max;
    return integer;
}

import type { GatewayConfig, ModelConfig } from "../config/index.ts";
import { knownModelContextWindowTokens } from "../config/index.ts";
import {
    buildGatewayControlAckPayload,
    buildGatewayControlCapabilityCatalogPayload,
    GatewayControlErrorCode,
    GatewayControlProtocolError,
    buildGatewayControlErrorPayload,
    buildGatewayControlGatewayStatusPayload,
    buildGatewayControlHistorySnapshotPayload,
    buildGatewayControlPongPayload,
    buildGatewayControlQuerySnapshotPayload,
    buildGatewayControlServerHelloSnapshot,
    buildGatewayControlSurfaceCapabilities,
    buildGatewayControlTurnDeltaPayload,
    buildGatewayControlTurnErrorPayload,
    buildGatewayControlTurnFinalPayload,
    createGatewayControlEnvelope,
    createGatewayControlEventEnvelope,
    type GatewayControlActiveAskSnapshot,
    type GatewayControlActiveForkSnapshot,
    GatewayControlReplyMetadataKind,
    normalizeGatewayControlMessage,
    parseGatewayControlEnvelope,
    readGatewayControlForkCreateInput,
    readGatewayControlHistoryListInput,
    readGatewayControlMessageInterruptInput,
    readGatewayControlMessageInput,
    readGatewayControlMessageUndoInput,
    readGatewayControlQueryPayload,
    readGatewayControlSubscription,
    readGatewayControlTaskPlanDecideInput,
    shouldDeliverGatewayControlEvent,
    type GatewayControlExecutiveLoopStateSnapshot,
    type GatewayControlHistoryListInput,
    type GatewayControlHistoryTurnSnapshot,
    type GatewayControlLongHorizonLoopSnapshot,
    type GatewayControlPlanningMetadataSnapshot,
    type GatewayControlReplyMetadata,
    type GatewayControlEnvelope,
    type GatewayControlGatewayStatusSnapshot,
    type GatewayControlReadCacheMetadata,
    type GatewayControlScopeSnapshot,
    type GatewayControlStateSnapshot,
    type GatewayControlPeer as ProtocolSocketControlPeer,
    type GatewayControlSocket as ProtocolSocketControlSocket,
    type GatewayControlTodoTaskSnapshot,
} from "../protocol/control/index.ts";
import {
    ChannelLinkState,
    ControlSnapshotStatus,
    GatewayControlMessageType,
    InteractionMode,
    SandboxMode,
    TaskPlanDecisionAction,
    type GatewayChannelCapabilities,
    type ChannelTransport,
    type ContextForkRecord,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
    type RuntimeEvent,
} from "../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../events/index.ts";
import type { FlyflorPaths } from "../config/index.ts";
import { buildBuiltinExternalKitCatalog, loadExternalKitCatalogSnapshot } from "./kit/index.ts";
import type { SocketQueryComponentPort } from "./query/index.ts";
import { SocketReadCache } from "./read.cache.ts";
import type { RuntimeStreamOptions } from "../agent/runtime/index.ts";

export type SocketControlPeer = ProtocolSocketControlPeer;
export type SocketControlSocket = ProtocolSocketControlSocket;
export type GatewayControlPeer = SocketControlPeer;
export type GatewayControlSocket = SocketControlSocket;

export interface SocketControlTransportChannelStatusSnapshot {
    adapter: string | null;
    capabilities: GatewayChannelCapabilities;
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
}

export interface SocketControlTransportStatusSnapshot {
    channels: SocketControlTransportChannelStatusSnapshot[];
    clientCount: number;
    connectedCount: number;
    context?: SocketControlContextTelemetrySnapshot;
    degradedCount: number;
    gatewayRunning: boolean;
    host: string;
    model?: ModelConfig;
    port: number;
    startedAt?: string;
    streamingCount: number;
    uptimeMs?: number;
    url?: string;
}

export interface SocketControlContextTelemetrySnapshot {
    compressionThresholdTokens?: number | null;
    contextUsedTokens?: number | null;
    currentTokens?: number | null;
    hotContextTokens?: number | null;
}

export interface SocketControlDispatchOptions {
    context?: RuntimeContext;
    onTextDelta?: (text: string) => void | Promise<void>;
    approveMcpToolCall?: RuntimeStreamOptions["approveMcpToolCall"];
    approveUserToolCall?: RuntimeStreamOptions["approveUserToolCall"];
    interactionMode?: RuntimeStreamOptions["interactionMode"];
    sandboxMode?: RuntimeStreamOptions["sandboxMode"];
    signal?: RuntimeStreamOptions["signal"];
}

export type SocketControlMessageDispatcher = (
    message: GatewayMessage,
    options?: SocketControlDispatchOptions,
) => Promise<GatewayReply>;

export interface SocketControlEventBus extends EventSink {
    subscribe(sink: EventSink): () => void;
}

export interface SocketControlHubOptions {
    config: GatewayConfig;
    /**
     * Explicit state-changing fork command boundary for clients. Socket owns
     * wire validation; Runtime/Memory still own durable fork persistence.
     */
    createContextFork?: (
        record: ContextForkRecord,
        source?: { assistantText?: string; eventId?: string; userText?: string },
    ) => Promise<ContextForkRecord>;
    dispatch: SocketControlMessageDispatcher;
    events: SocketControlEventBus;
    recordUndo?: (input: { anchorEventId?: string; anchorMessageId?: string; reason?: string; turnIndex?: number }) => Promise<{ abandoned: number; undoEventId?: string }>;
    paths?: FlyflorPaths;
    queries?: SocketQueryComponentPort;
    status: () => SocketControlTransportStatusSnapshot;
}

type SocketControlHandler = (
    socket: SocketControlSocket,
    envelope: GatewayControlEnvelope,
) => void | Promise<void>;

interface SocketControlActiveTurn {
    controller: AbortController;
    publicMessageId: string;
    requestId: string;
    socketClientId: string;
}

/**
 * Socket control/event transport for first-party clients.
 *
 * The current transport is WebSocket, but this owner is the lifeform vascular
 * layer: live turns, events, operation snapshots and ledger query/replay move
 * through here. The `gateway.*` message strings remain wire-v1 compatibility
 * names and must not be treated as session/chat continuity.
 */
export class SocketControlHub implements EventSink {
    private readonly clients = new Set<SocketControlSocket>();
    private readonly handlers = new Map<string, SocketControlHandler>();
    private readonly readCache = new SocketReadCache<Record<string, unknown>>();
    private readonly activeTurns = new Map<string, SocketControlActiveTurn>();
    private capabilityCatalog: Record<string, unknown> | null = null;
    private controlState: GatewayControlStateSnapshot = {};
    private readonly unsubscribeEvents: () => void;

    public constructor(private readonly options: SocketControlHubOptions) {
        this.handlers.set(GatewayControlMessageType.CapabilityCatalogGet, async (socket, envelope) =>
            this.handleCapabilityCatalogGet(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.ClientHello, (socket, envelope) =>
            this.handleClientHello(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.EventSubscribe, (socket, envelope) =>
            this.handleEventSubscribe(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.EventUnsubscribe, (socket, envelope) =>
            this.handleEventUnsubscribe(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.ForkCreate, (socket, envelope) =>
            this.handleForkCreate(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.GatewayStatusGet, (socket, envelope) =>
            this.handleGatewayStatusGet(socket, envelope),
        );
        this.registerQueryHandlers();
        this.handlers.set(GatewayControlMessageType.HistoryList, async (socket, envelope) =>
            this.handleHistoryList(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.TaskPlanDecide, (socket, envelope) =>
            this.handleTaskPlanDecide(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.GatewayMessageSend, (socket, envelope) =>
            this.handleGatewayMessageSend(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.GatewayMessageInterrupt, (socket, envelope) =>
            this.handleGatewayMessageInterrupt(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.GatewayMessageUndo, (socket, envelope) =>
            this.handleGatewayMessageUndo(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.Ping, (socket, envelope) => this.handlePing(socket, envelope));
        this.unsubscribeEvents = this.options.events.subscribe(this);
    }

    public upgrade(request: Request, server: Bun.Server<SocketControlPeer>): Response | undefined {
        if (!this.authorize(request)) {
            this.log("upgrade.denied", { url: request.url });
            return new Response(JSON.stringify({ error: "gateway_control_unauthorized" }), {
                status: 401,
                headers: { "content-type": "application/json; charset=utf-8" },
            });
        }
        const clientId = crypto.randomUUID();
        const ok = server.upgrade(request, {
            data: {
                clientId,
                connectedAt: new Date().toISOString(),
                subscriptions: [],
            },
        });
        this.log(ok ? "upgrade.accepted" : "upgrade.failed", { clientId, url: request.url });
        return ok ? undefined : new Response(JSON.stringify({ error: "gateway_control_upgrade_failed" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" },
        });
    }

    public open(socket: SocketControlSocket): void {
        this.invalidateReadCache();
        this.clients.add(socket);
        this.log("socket.open", { clientId: socket.data.clientId, connectedAt: socket.data.connectedAt });
        void this.sendServerHello(socket).catch((error) => this.sendError(socket, undefined, error));
    }

    public close(socket: SocketControlSocket): void {
        this.clients.delete(socket);
        this.invalidateReadCache();
        this.log("socket.close", { clientId: socket.data.clientId });
    }

    public getClientCount(): number {
        return this.clients.size;
    }

    public async message(socket: SocketControlSocket, raw: string | Buffer): Promise<void> {
        let envelope: GatewayControlEnvelope;
        try {
            envelope = parseGatewayControlEnvelope(raw);
        } catch (error) {
            this.log("message.invalid_envelope", {
                clientId: socket.data.clientId,
                message: error instanceof Error ? error.message : String(error),
            });
            this.sendError(socket, undefined, error, GatewayControlErrorCode.InvalidEnvelope);
            return;
        }
        this.log("message.received", {
            clientId: socket.data.clientId,
            id: envelope.id,
            requestId: envelope.requestId,
            type: envelope.type,
        });
        const handler = this.handlers.get(envelope.type);
        if (!handler) {
            this.log("message.unsupported", {
                clientId: socket.data.clientId,
                type: envelope.type,
            });
            this.sendError(
                socket,
                envelope,
                new Error(`Unsupported gateway control message: ${envelope.type}`),
                GatewayControlErrorCode.UnsupportedMessage,
            );
            return;
        }
        try {
            await handler(socket, envelope);
        } catch (error) {
            this.log("message.failed", {
                clientId: socket.data.clientId,
                id: envelope.id,
                message: error instanceof Error ? error.message : String(error),
                type: envelope.type,
            });
            const code = error instanceof GatewayControlProtocolError ? error.code : GatewayControlErrorCode.Internal;
            this.sendError(socket, envelope, error, code);
        }
    }

    public publish(event: RuntimeEvent): void {
        if (event.type === RuntimeEventType.ExecutiveCapabilityCatalogBuilt && event.payload) {
            this.capabilityCatalog = event.payload;
        }
        this.invalidateReadCache();
        this.updateControlStateFromEvent(event);
        const envelope = createGatewayControlEventEnvelope(event);
        for (const client of this.clients) {
            if (shouldDeliverGatewayControlEvent(event, client.data.subscriptions)) {
                client.send(JSON.stringify(envelope));
            }
        }
    }

    public dispose(): void {
        this.log("dispose", { clientCount: this.clients.size });
        this.unsubscribeEvents();
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
    }

    private handleClientHello(socket: SocketControlSocket, envelope: GatewayControlEnvelope): void {
        this.log("client.hello", { clientId: socket.data.clientId, correlationId: envelope.id });
        this.send(socket, GatewayControlMessageType.Ack, buildGatewayControlAckPayload({
            clientId: socket.data.clientId,
            received: envelope.type,
        }), envelope);
    }

    private async handleCapabilityCatalogGet(
        socket: SocketControlSocket,
        envelope: GatewayControlEnvelope,
    ): Promise<void> {
        const kits = this.options.paths
            ? await loadExternalKitCatalogSnapshot(this.options.paths)
            : buildBuiltinExternalKitCatalog();
        this.log("capability.catalog.snapshot", { clientId: socket.data.clientId });
        this.send(
            socket,
            GatewayControlMessageType.CapabilityCatalogSnapshot,
            buildGatewayControlCapabilityCatalogPayload(this.capabilityCatalog, kits),
            envelope,
        );
    }

    private handleEventSubscribe(socket: SocketControlSocket, envelope: GatewayControlEnvelope): void {
        const subscription = readGatewayControlSubscription(envelope.payload);
        socket.data.subscriptions = [...socket.data.subscriptions, subscription];
        this.log("event.subscribe", {
            clientId: socket.data.clientId,
            subscriptionCount: socket.data.subscriptions.length,
        });
        this.send(socket, GatewayControlMessageType.Ack, buildGatewayControlAckPayload({
            subscriptions: socket.data.subscriptions,
        }), envelope);
    }

    private handleEventUnsubscribe(socket: SocketControlSocket, envelope: GatewayControlEnvelope): void {
        const subscription = readGatewayControlSubscription(envelope.payload);
        socket.data.subscriptions = socket.data.subscriptions.filter((candidate) => {
            if (subscription.requestId && candidate.requestId !== subscription.requestId) return true;
            if (subscription.types && subscription.types.length > 0) {
                const types = candidate.types ?? [];
                return !types.some((type) => subscription.types?.includes(type));
            }
            return false;
        });
        this.log("event.unsubscribe", {
            clientId: socket.data.clientId,
            subscriptionCount: socket.data.subscriptions.length,
        });
        this.send(socket, GatewayControlMessageType.Ack, buildGatewayControlAckPayload({
            subscriptions: socket.data.subscriptions,
        }), envelope);
    }

    private handleGatewayStatusGet(socket: SocketControlSocket, envelope: GatewayControlEnvelope): void {
        this.log("gateway.status.get", { clientId: socket.data.clientId });
        const key = this.readCacheKey(envelope.type, envelope.payload);
        const cached = this.readCache.get(key);
        if (cached) {
            this.send(
                socket,
                GatewayControlMessageType.GatewayStatusSnapshot,
                this.withReadCacheHit(cached, key),
                envelope,
            );
            return;
        }
        const cache = this.readCacheMetadata(key, false);
        const payload = buildGatewayControlGatewayStatusPayload(
            this.protocolStatusSnapshot(this.options.status()),
            cache,
        );
        this.readCache.set(key, payload);
        this.send(
            socket,
            GatewayControlMessageType.GatewayStatusSnapshot,
            payload,
            envelope,
        );
    }

    private async handleHistoryList(socket: SocketControlSocket, envelope: GatewayControlEnvelope): Promise<void> {
        const input = readGatewayControlHistoryListInput(envelope.payload);
        const key = this.readCacheKey(envelope.type, input);
        const cached = this.readCache.get(key);
        if (cached) {
            this.send(socket, GatewayControlMessageType.HistorySnapshot, this.withReadCacheHit(cached, key), envelope);
            return;
        }
        const queries = this.requiredQueries();
        await queries.initialize();
        const history = queries.historyList(input);
        this.log("history.snapshot", {
            beforeTs: input.beforeTs,
            clientId: socket.data.clientId,
            count: history.length,
            limit: input.limit,
        });
        const payload = buildGatewayControlHistorySnapshotPayload({
            cache: this.readCacheMetadata(key, false),
            history: history.map((turn) => this.historyTurnSnapshot(turn)),
            nextBeforeTs: history.length > 0 && history[0] ? history[0].ts - 1 : undefined,
        });
        this.readCache.set(key, payload);
        this.send(socket, GatewayControlMessageType.HistorySnapshot, payload, envelope);
    }

    private async handleQuery(
        socket: SocketControlSocket,
        envelope: GatewayControlEnvelope,
        snapshotType: Parameters<typeof this.send>[1],
        reader: (payload: Record<string, unknown>) => unknown | Promise<unknown>,
    ): Promise<void> {
        const payload = readGatewayControlQueryPayload(envelope.payload);
        const key = this.readCacheKey(envelope.type, payload);
        const cached = this.readCache.get(key);
        if (cached) {
            this.send(socket, snapshotType, this.withReadCacheHit(cached, key), envelope);
            return;
        }
        await this.requiredQueries().initialize();
        const data = await reader(payload);
        this.log("query.snapshot", {
            clientId: socket.data.clientId,
            requestId: envelope.requestId,
            snapshotType,
            type: envelope.type,
        });
        const response = buildGatewayControlQuerySnapshotPayload(data ?? null, this.readCacheMetadata(key, false));
        this.readCache.set(key, response);
        this.send(socket, snapshotType, response, envelope);
    }

    private async handleForkMemoryGet(socket: SocketControlSocket, envelope: GatewayControlEnvelope): Promise<void> {
        const payload = readGatewayControlQueryPayload(envelope.payload);
        const key = this.readCacheKey(envelope.type, payload);
        const cached = this.readCache.get(key);
        if (cached) {
            this.send(socket, GatewayControlMessageType.ForkMemorySnapshot, this.withReadCacheHit(cached, key), envelope);
            return;
        }
        const data = await this.requiredQueries().forkMemory(payload);
        this.log("query.snapshot", {
            clientId: socket.data.clientId,
            requestId: envelope.requestId,
            snapshotType: GatewayControlMessageType.ForkMemorySnapshot,
            type: envelope.type,
        });
        const response = buildGatewayControlQuerySnapshotPayload(data, this.readCacheMetadata(key, false));
        this.readCache.set(key, response);
        this.send(socket, GatewayControlMessageType.ForkMemorySnapshot, response, envelope);
    }

    private async handleForkCreate(socket: SocketControlSocket, envelope: GatewayControlEnvelope): Promise<void> {
        if (!this.options.createContextFork) {
            throw new GatewayControlProtocolError(
                GatewayControlErrorCode.Internal,
                "fork.create is unavailable",
            );
        }
        const input = readGatewayControlForkCreateInput(envelope.payload);
        const now = new Date().toISOString();
        const scope = input.context?.activeScope ?? input.context?.activeProject;
        const scopeId = input.scopeId ?? scope?.id;
        const parentId = input.parentId ?? input.context?.contextForkId;
        const ownerKey = this.forkOwnerKey(scopeId, parentId, envelope.requestId);
        const fork: ContextForkRecord = {
            id: input.id ?? `fork-${crypto.randomUUID()}`,
            ownerKey,
            ...(scopeId ? { scopeId } : {}),
            ...(parentId ? { parentId } : {}),
            title: input.title,
            summary: input.summary,
            continuitySummary: input.continuitySummary,
            maxContextTokens: input.maxContextTokens,
            inheritedEventIds: input.inheritedEventIds,
            createdAt: now,
            updatedAt: now,
            ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
            ...(input.sourceAskId ? { sourceAskId: input.sourceAskId } : {}),
            ...(input.sourceBlackboardTurnId ? { sourceBlackboardTurnId: input.sourceBlackboardTurnId } : {}),
        };
        const written = await this.options.createContextFork(fork, {
            eventId: input.sourceEventId,
        });
        this.invalidateReadCache();
        this.controlState = {
            ...this.controlState,
            activeFork: {
                id: written.id,
                continuitySummary: written.continuitySummary,
                maxContextTokens: written.maxContextTokens,
                title: written.title,
                at: now,
                requestId: envelope.requestId,
                status: ControlSnapshotStatus.Active,
            },
        };
        this.log("fork.created", {
            clientId: socket.data.clientId,
            forkId: written.id,
            ownerKey: written.ownerKey,
            requestId: envelope.requestId,
        });
        this.send(
            socket,
            GatewayControlMessageType.ForkSnapshot,
            buildGatewayControlQuerySnapshotPayload({
                fork: written,
                session: {
                    activeForkId: written.id,
                    parentId: written.parentId,
                    rootId: this.rootForkId(written),
                },
            }),
            envelope,
            envelope.requestId,
        );
    }

    private async handleTaskPlanDecide(socket: SocketControlSocket, envelope: GatewayControlEnvelope): Promise<void> {
        const input = readGatewayControlTaskPlanDecideInput(envelope.payload);
        try {
            await this.requiredQueries().initialize();
            const taskPlan = this.requiredQueries().taskPlanDecide(input);
            if (!taskPlan) {
                this.options.events.publish(event(RuntimeEventType.MemoryTaskPlanDecisionFailed, {
                    action: input.action,
                    planId: input.planId,
                    reason: "not-found",
                }, envelope.requestId));
                throw new GatewayControlProtocolError(
                    GatewayControlErrorCode.InvalidPayload,
                    "task.plan.decide planId was not found",
                );
            }
            this.invalidateReadCache();
            this.options.events.publish(event(RuntimeEventType.MemoryTaskPlanDecided, {
                action: input.action,
                planId: taskPlan.id,
                revision: input.action === TaskPlanDecisionAction.Revise ? input.revision : undefined,
                status: taskPlan.status,
            }, envelope.requestId));
            this.send(
                socket,
                GatewayControlMessageType.TaskSnapshot,
                buildGatewayControlQuerySnapshotPayload({ taskPlan }),
                envelope,
            );
        } catch (error) {
            if (!(error instanceof GatewayControlProtocolError)) {
                this.options.events.publish(event(RuntimeEventType.MemoryTaskPlanDecisionFailed, {
                    action: input.action,
                    message: error instanceof Error ? error.message : String(error),
                    planId: input.planId,
                }, envelope.requestId));
            }
            throw error;
        }
    }

    private async handleGatewayMessageSend(
        socket: SocketControlSocket,
        envelope: GatewayControlEnvelope,
    ): Promise<void> {
        const input = readGatewayControlMessageInput(envelope.payload);
        this.invalidateReadCache();
        const context = this.contextFromInput(input.context, envelope.requestId);
        const gatewayMessage = this.messageFromInput(input);
        const publicMessageId = this.publicMessageId(gatewayMessage);
        const sandboxMode = this.sandboxModeFromMetadata(gatewayMessage.metadata);
        const interactionMode = this.interactionModeFromMetadata(gatewayMessage.metadata);
        const controller = new AbortController();
        this.activeTurns.set(context.requestId, {
            controller,
            publicMessageId,
            requestId: context.requestId,
            socketClientId: socket.data.clientId,
        });
        this.log("turn.start", {
            channel: gatewayMessage.route.channel,
            clientId: socket.data.clientId,
            messageId: gatewayMessage.id,
            publicMessageId,
            requestId: context.requestId,
        });
        if (sandboxMode === SandboxMode.Yolo) {
            this.publishYoloAudit(RuntimeEventType.SandboxYoloEntered, gatewayMessage, publicMessageId, context.requestId);
        }
        try {
            const reply = await this.options.dispatch(gatewayMessage, {
                context,
                onTextDelta: (delta) => {
                    this.send(
                        socket,
                        GatewayControlMessageType.TurnDelta,
                        buildGatewayControlTurnDeltaPayload(delta, publicMessageId),
                        envelope,
                        context.requestId,
                    );
                },
                approveMcpToolCall: input.context?.toolApprovals?.mcpToolCalls === true
                    ? async () => true
                    : undefined,
                approveUserToolCall: input.context?.toolApprovals?.userToolCalls === true
                    ? async () => true
                    : undefined,
                interactionMode,
                sandboxMode,
                signal: controller.signal,
            });
            this.log("turn.final", {
                channel: gatewayMessage.route.channel,
                clientId: socket.data.clientId,
                messageId: gatewayMessage.id,
                publicMessageId,
                requestId: context.requestId,
            });
            const publicReply = { ...reply, messageId: publicMessageId };
            this.updateControlStateFromReply(publicReply, context);
            this.send(
                socket,
                GatewayControlMessageType.TurnFinal,
                buildGatewayControlTurnFinalPayload(publicReply),
                envelope,
                context.requestId,
            );
        } catch (error) {
            this.log("turn.error", {
                channel: gatewayMessage.route.channel,
                clientId: socket.data.clientId,
                message: error instanceof Error ? error.message : String(error),
                messageId: gatewayMessage.id,
                publicMessageId,
                requestId: context.requestId,
            });
            this.send(
                socket,
                GatewayControlMessageType.TurnError,
                buildGatewayControlTurnErrorPayload(
                    error instanceof Error ? error.message : String(error),
                    publicMessageId,
                ),
                envelope,
                context.requestId,
            );
        } finally {
            this.activeTurns.delete(context.requestId);
            if (sandboxMode === SandboxMode.Yolo) {
                this.publishYoloAudit(RuntimeEventType.SandboxYoloExited, gatewayMessage, publicMessageId, context.requestId);
            }
        }
    }

    private handleGatewayMessageInterrupt(
        socket: SocketControlSocket,
        envelope: GatewayControlEnvelope,
    ): void {
        const input = readGatewayControlMessageInterruptInput(envelope.payload);
        let interrupted = 0;
        for (const [key, turn] of this.activeTurns) {
            if (turn.socketClientId !== socket.data.clientId) continue;
            if (input.requestId && turn.requestId !== input.requestId) continue;
            if (input.messageId && turn.publicMessageId !== input.messageId) continue;
            if (!input.requestId && !input.messageId && this.activeTurns.size !== 1) continue;
            turn.controller.abort();
            interrupted += 1;
            this.activeTurns.delete(key);
        }
        this.log("turn.interrupt", {
            clientId: socket.data.clientId,
            interrupted,
            messageId: input.messageId,
            requestId: input.requestId,
        });
        this.send(socket, GatewayControlMessageType.Ack, buildGatewayControlAckPayload({
            clientId: socket.data.clientId,
            interrupted,
            received: GatewayControlMessageType.GatewayMessageInterrupt,
        }), envelope);
    }

    private async handleGatewayMessageUndo(
        socket: SocketControlSocket,
        envelope: GatewayControlEnvelope,
    ): Promise<void> {
        const input = readGatewayControlMessageUndoInput(envelope.payload);
        this.invalidateReadCache();
        const result = this.options.recordUndo
            ? await this.options.recordUndo(input)
            : { abandoned: 0, undoEventId: undefined };
        this.log("turn.undo", {
            anchorEventId: input.anchorEventId,
            anchorMessageId: input.anchorMessageId,
            clientId: socket.data.clientId,
            abandoned: result.abandoned,
        });
        this.send(socket, GatewayControlMessageType.Ack, buildGatewayControlAckPayload({
            abandoned: result.abandoned,
            clientId: socket.data.clientId,
            received: GatewayControlMessageType.GatewayMessageUndo,
            undoEventId: result.undoEventId,
        }), envelope);
    }

    private handlePing(socket: SocketControlSocket, envelope: GatewayControlEnvelope): void {
        this.log("ping", { clientId: socket.data.clientId });
        this.send(socket, GatewayControlMessageType.Pong, buildGatewayControlPongPayload(), envelope);
    }

    private registerQueryHandlers(): void {
        this.handlers.set(GatewayControlMessageType.HistoryDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.HistorySnapshot, (payload) =>
                this.requiredQueries().historyDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ScopeList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ScopeSnapshot, (payload) =>
                this.requiredQueries().scopeList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ScopeDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ScopeSnapshot, (payload) =>
                this.requiredQueries().scopeDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ForkList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ForkSnapshot, (payload) =>
                this.requiredQueries().forkList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ForkMemoryGet, (socket, envelope) =>
            this.handleForkMemoryGet(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.ForkDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ForkSnapshot, (payload) =>
                this.requiredQueries().forkDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.AskList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.AskSnapshot, (payload) =>
                this.requiredQueries().askList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.AskDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.AskSnapshot, (payload) =>
                this.requiredQueries().askDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ConfirmList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ConfirmSnapshot, (payload) =>
                this.requiredQueries().confirmList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ConfirmDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ConfirmSnapshot, (payload) =>
                this.requiredQueries().confirmDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.BlackboardList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.BlackboardSnapshot, (payload) =>
                this.requiredQueries().blackboardList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.BlackboardDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.BlackboardSnapshot, (payload) =>
                this.requiredQueries().blackboardDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.TaskList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.TaskSnapshot, (payload) =>
                this.requiredQueries().taskList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.TaskDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.TaskSnapshot, (payload) =>
                this.requiredQueries().taskDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ReplayList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ReplaySnapshot, (payload) =>
                this.requiredQueries().replayList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ReplayDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ReplaySnapshot, (payload) =>
                this.requiredQueries().replayDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ThoughtDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ThoughtSnapshot, (payload) =>
                this.requiredQueries().thoughtDetail(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.CrystalList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.CrystalSnapshot, (payload) =>
                this.requiredQueries().crystalList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ExecutionJobList, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ExecutionJobSnapshot, (payload) =>
                this.requiredQueries().executionJobList(payload),
            ),
        );
        this.handlers.set(GatewayControlMessageType.ExecutionJobDetailGet, (socket, envelope) =>
            this.handleQuery(socket, envelope, GatewayControlMessageType.ExecutionJobSnapshot, (payload) =>
                this.requiredQueries().executionJobDetail(payload),
            ),
        );
    }

    private requiredQueries(): SocketQueryComponentPort {
        if (!this.options.queries) {
            throw new GatewayControlProtocolError(
                GatewayControlErrorCode.Internal,
                "Socket query read model is unavailable",
            );
        }
        return this.options.queries;
    }

    private messageFromInput(input: ReturnType<typeof readGatewayControlMessageInput>): GatewayMessage {
        const message = normalizeGatewayControlMessage(input);
        return {
            ...message,
            id: crypto.randomUUID(),
            metadata: {
                ...(message.metadata ?? {}),
                clientMessageId: message.id,
            },
        };
    }

    private sandboxModeFromMetadata(metadata: GatewayMessage["metadata"]): RuntimeStreamOptions["sandboxMode"] {
        const interaction = this.recordValue(metadata?.interaction);
        if (interaction?.yolo === true) return SandboxMode.Yolo;
        const tui = this.recordValue(metadata?.tui);
        if (tui?.yolo === true) return SandboxMode.Yolo;
        const permissions = this.recordValue(metadata?.permissions);
        return permissions?.mode === SandboxMode.Yolo ? SandboxMode.Yolo : undefined;
    }

    private interactionModeFromMetadata(metadata: GatewayMessage["metadata"]): RuntimeStreamOptions["interactionMode"] {
        const interaction = this.recordValue(metadata?.interaction);
        if (interaction?.mode === InteractionMode.Plan) return InteractionMode.Plan;
        if (interaction?.mode === InteractionMode.Act) return InteractionMode.Act;
        const tui = this.recordValue(metadata?.tui);
        if (tui?.mode === "plan") return InteractionMode.Plan;
        if (tui?.mode === "chat") return InteractionMode.Act;
        return undefined;
    }

    private recordValue(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }

    private publishYoloAudit(
        type: typeof RuntimeEventType.SandboxYoloEntered | typeof RuntimeEventType.SandboxYoloExited,
        message: GatewayMessage,
        publicMessageId: string,
        requestId: string,
    ): void {
        this.options.events?.publish(event(type, {
            channel: message.route.channel,
            clientMessageId: typeof message.metadata?.clientMessageId === "string"
                ? message.metadata.clientMessageId
                : undefined,
            messageId: message.id,
            publicMessageId,
            sandboxMode: SandboxMode.Yolo,
            source: "tui",
        }, requestId));
    }

    private publicMessageId(message: GatewayMessage): string {
        return typeof message.metadata?.clientMessageId === "string" && message.metadata.clientMessageId.length > 0
            ? message.metadata.clientMessageId
            : message.id;
    }

    /**
     * History replay is a read model over already-persisted structured runtime
     * records. It mirrors compact live `turn.final.reply.metadata` lanes without
     * importing RuntimeModule internals or changing turn execution.
     */
    private historyTurnSnapshot(turn: GatewayControlHistoryTurnSnapshot): GatewayControlHistoryTurnSnapshot {
        const metadata = this.historyMetadataSnapshot(turn);
        return metadata ? { ...turn, metadata } : turn;
    }

    private historyMetadataSnapshot(turn: GatewayControlHistoryTurnSnapshot): GatewayControlReplyMetadata | undefined {
        const planning = this.historyPlanningMetadata(turn);
        const executiveToolExecutions = turn.executiveToolExecutions ?? [];
        if (!planning && executiveToolExecutions.length === 0) return turn.metadata;
        return {
            ...(turn.metadata ?? {}),
            kind: turn.metadata?.kind ?? GatewayControlReplyMetadataKind.Reply,
            messageId: turn.eventId,
            ...(executiveToolExecutions.length > 0 ? { executiveToolExecutions } : {}),
            ...(planning ? { planning } : {}),
        };
    }

    private historyPlanningMetadata(
        turn: GatewayControlHistoryTurnSnapshot,
    ): GatewayControlPlanningMetadataSnapshot | undefined {
        const taskPlans = (turn.taskPlans ?? []).map((plan): GatewayControlTodoTaskSnapshot => ({
            completedStepCount: plan.completedStepCount,
            id: plan.id,
            progress: plan.progress,
            status: plan.status,
            stepCount: plan.stepCount,
            steps: (plan.step ?? []).slice(0, 8).map((step) => ({
                id: step.id,
                order: step.order,
                progress: step.progress,
                status: step.status,
                title: step.title,
            })),
            summary: plan.summary,
            title: plan.title,
        }));
        const contextForks = (turn.contextForks ?? []).map((fork) => ({
            id: fork.id,
            continuitySummary: fork.continuitySummary,
            maxContextTokens: fork.maxContextTokens,
            title: fork.title,
        }));
        const replays = (turn.replays ?? []).map((replay) => ({
            blackboardTurnId: replay.blackboardTurnId,
            contextForkId: replay.contextForkId,
            id: replay.id,
            kind: replay.kind,
            summary: replay.summary,
            taskPlanId: replay.taskPlanId,
            title: replay.title,
        }));
        if (taskPlans.length === 0 && contextForks.length === 0 && replays.length === 0) {
            return undefined;
        }
        return { contextForks, replays, taskPlans };
    }

    private contextFromInput(
        input: ReturnType<typeof readGatewayControlMessageInput>["context"],
        requestId?: string,
    ): RuntimeContext {
        const activeScope = input?.activeScope ?? input?.activeProject;
        return {
            requestId: requestId ?? crypto.randomUUID(),
            now: new Date().toISOString(),
            activeScope,
            contextForkId: input?.contextForkId,
            skillNames: input?.skillNames,
        };
    }

    private forkOwnerKey(scopeId: string | undefined, parentId: string | undefined, requestId: string | undefined): string {
        if (scopeId) return `scope:${scopeId}`;
        if (parentId) return `fork:${parentId}`;
        return `turn:${requestId ?? crypto.randomUUID()}`;
    }

    private rootForkId(fork: ContextForkRecord): string {
        return fork.parentId ?? fork.id;
    }

    private updateControlStateFromReply(reply: GatewayReply, context: RuntimeContext): void {
        const at = new Date().toISOString();
        const metadata = reply.metadata as GatewayControlReplyMetadata | undefined;
        this.controlState = {
            ...this.controlState,
            activeScope: this.scopeSnapshotFromContext(context) ?? this.controlState.activeScope,
            activeFork: this.activeForkSnapshot(metadata?.planning, context, at) ?? this.controlState.activeFork,
            activeAsk: this.activeAskSnapshot(metadata, reply.messageId, context.requestId, at) ?? this.resumedAskSnapshot(at),
            executiveLoop: this.executiveLoopSnapshotFromMetadata(metadata, context.requestId, at)
                ?? this.controlState.executiveLoop,
        };
    }

    private updateControlStateFromEvent(event: RuntimeEvent): void {
        const at = event.at;
        if (event.type === RuntimeEventType.ExecutiveLoopPaused) {
            this.controlState = {
                ...this.controlState,
                executiveLoop: this.executiveLoopSnapshotFromPayload(event.payload, event.requestId, at),
            };
            return;
        }
        if (event.type === RuntimeEventType.ExecutiveLoopResumed) {
            this.controlState = {
                ...this.controlState,
                activeAsk: this.resumedAskSnapshot(at),
                executiveLoop: {
                    ...(this.controlState.executiveLoop ?? {}),
                    askId: this.readPayloadString(event.payload, "askId") ?? this.controlState.executiveLoop?.askId,
                    at,
                    requestId: event.requestId,
                    status: ControlSnapshotStatus.Resumed,
                },
            };
            return;
        }
        if (event.type === RuntimeEventType.MemoryAskAnswered) {
            this.controlState = {
                ...this.controlState,
                activeAsk: this.resumedAskSnapshot(at),
            };
        }
    }

    private activeAskSnapshot(
        metadata: GatewayControlReplyMetadata | undefined,
        messageId: string,
        requestId: string | undefined,
        at: string,
    ): GatewayControlActiveAskSnapshot | undefined {
        if (!metadata?.ask) return undefined;
        return {
            ask: metadata.ask,
            at,
            messageId,
            requestId,
            status: ControlSnapshotStatus.Active,
        };
    }

    private resumedAskSnapshot(at: string): GatewayControlActiveAskSnapshot | undefined {
        const activeAsk = this.controlState.activeAsk;
        if (!activeAsk || activeAsk.status !== ControlSnapshotStatus.Active) return activeAsk;
        return {
            ...activeAsk,
            at,
            status: ControlSnapshotStatus.Resumed,
        };
    }

    private activeForkSnapshot(
        planning: GatewayControlPlanningMetadataSnapshot | undefined,
        context: RuntimeContext,
        at: string,
    ): GatewayControlActiveForkSnapshot | undefined {
        const fork = planning?.contextForks.find((candidate) => candidate.id === context.contextForkId)
            ?? planning?.contextForks.at(0);
        if (!fork) return undefined;
        return {
            ...fork,
            at,
            requestId: context.requestId,
            status: ControlSnapshotStatus.Active,
        };
    }

    private scopeSnapshotFromContext(context: RuntimeContext): GatewayControlScopeSnapshot | undefined {
        if (!context.activeScope) return undefined;
        return {
            id: context.activeScope.id,
            projectDir: context.activeScope.projectDir,
            projectMemoryDir: context.activeScope.projectMemoryDir,
            title: context.activeScope.title,
        };
    }

    private executiveLoopSnapshotFromMetadata(
        metadata: GatewayControlReplyMetadata | undefined,
        requestId: string | undefined,
        at: string,
    ): GatewayControlExecutiveLoopStateSnapshot | undefined {
        const loop = metadata?.executiveToolLoop ?? metadata?.ask?.executiveToolLoop;
        if (!loop) return undefined;
        return this.executiveLoopSnapshot(loop, requestId, at, ControlSnapshotStatus.Paused);
    }

    private executiveLoopSnapshot(
        loop: GatewayControlLongHorizonLoopSnapshot,
        requestId: string | undefined,
        at: string,
        status: GatewayControlExecutiveLoopStateSnapshot["status"],
    ): GatewayControlExecutiveLoopStateSnapshot {
        return {
            askId: loop.askId,
            at,
            loopGuardReason: loop.loopGuardReason,
            loopGuardSnapshot: loop.loopGuardSnapshot,
            message: loop.message,
            requestId,
            resume: loop.resume,
            status,
            stepCount: loop.stepCount,
            stop: loop.stop,
            toolBudgetExhausted: loop.toolBudgetExhausted,
        };
    }

    private executiveLoopSnapshotFromPayload(
        payload: Record<string, unknown> | undefined,
        requestId: string | undefined,
        at: string,
    ): GatewayControlExecutiveLoopStateSnapshot {
        return {
            askId: this.readPayloadString(payload, "askId"),
            at,
            loopGuardReason: this.readPayloadString(payload, "loopGuardReason"),
            loopGuardSnapshot: this.readLoopGuardSnapshot(payload?.loopGuardSnapshot),
            requestId,
            status: ControlSnapshotStatus.Paused,
            stepCount: this.readPayloadNumber(payload, "stepCount"),
            stop: "ask",
            toolBudgetExhausted: payload?.toolBudgetExhausted === true ? true : undefined,
        };
    }

    private readLoopGuardSnapshot(value: unknown): GatewayControlExecutiveLoopStateSnapshot["loopGuardSnapshot"] {
        return value && typeof value === "object" && !Array.isArray(value)
            ? value as GatewayControlExecutiveLoopStateSnapshot["loopGuardSnapshot"]
            : undefined;
    }

    private readPayloadString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
        const value = payload?.[key];
        return typeof value === "string" && value.length > 0 ? value : undefined;
    }

    private readPayloadNumber(payload: Record<string, unknown> | undefined, key: string): number | undefined {
        const value = payload?.[key];
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

    private send<TPayload extends Record<string, unknown>>(
        socket: SocketControlSocket,
        type: Parameters<typeof createGatewayControlEnvelope<TPayload>>[0],
        payload?: TPayload,
        source?: GatewayControlEnvelope,
        requestId?: string,
    ): void {
        this.log("message.send", {
            clientId: socket.data.clientId,
            correlationId: source?.id,
            requestId: requestId ?? source?.requestId,
            type,
        });
        socket.send(
            JSON.stringify(
                createGatewayControlEnvelope(type, payload, {
                    correlationId: source?.id,
                    requestId: requestId ?? source?.requestId,
                }),
            ),
        );
    }

    private async sendServerHello(socket: SocketControlSocket): Promise<void> {
        const kits = this.options.paths
            ? await loadExternalKitCatalogSnapshot(this.options.paths)
            : buildBuiltinExternalKitCatalog();
        this.send(socket, GatewayControlMessageType.ServerHello, buildGatewayControlServerHelloSnapshot({
            clientId: socket.data.clientId,
            connectedAt: socket.data.connectedAt,
            capabilities: buildGatewayControlSurfaceCapabilities([...this.handlers.keys()]),
            kits,
            status: this.protocolStatusSnapshot(this.options.status()),
        }));
    }

    private sendError(
        socket: SocketControlSocket,
        source: GatewayControlEnvelope | undefined,
        cause: unknown,
        code: GatewayControlErrorCode = GatewayControlErrorCode.Internal,
    ): void {
        this.log("message.error", {
            clientId: socket.data.clientId,
            code,
            correlationId: source?.id,
            message: cause instanceof Error ? cause.message : String(cause),
            requestId: source?.requestId,
        });
        this.send(
            socket,
            GatewayControlMessageType.Error,
            buildGatewayControlErrorPayload(cause instanceof Error ? cause.message : String(cause), {
                code,
                // Preserve parser/reader diagnostics on the wire. These details
                // are protocol-shaped, not runtime internals or context state.
                details: cause instanceof GatewayControlProtocolError ? cause.details : undefined,
            }),
            source,
        );
    }

    private authorize(request: Request): boolean {
        const token = this.options.config.control?.token;
        if (typeof token === "string" && token.length > 0) {
            const auth = request.headers.get("authorization");
            const urlToken = new URL(request.url).searchParams.get("token");
            return auth === `Bearer ${token}` || urlToken === token;
        }
        return this.isLocalRequest(request);
    }

    /**
     * Socket runtime snapshots are local transport state. Protocol snapshots
     * are the stable JSON shape exposed to Rust/thin clients.
     */
    private protocolStatusSnapshot(status: SocketControlTransportStatusSnapshot): GatewayControlGatewayStatusSnapshot {
        return {
            channels: status.channels.map((channel) => ({
                adapter: channel.adapter,
                capabilities: channel.capabilities,
                configured: channel.configured,
                connected: Boolean(channel.connected),
                detail: channel.detail,
                implemented: channel.implemented,
                lastError: channel.lastError,
                lastErrorAt: channel.lastErrorAt,
                lastInboundAt: channel.lastInboundAt,
                lastOutboundAt: channel.lastOutboundAt,
                name: channel.name,
                state: channel.state ?? ChannelLinkState.Waiting,
                streaming: Boolean(channel.streaming),
                transport: channel.transport,
            })),
            // Peer count belongs to the live hub, not the channel registry.
            clientCount: this.clients.size,
            connectedCount: status.connectedCount,
            controlState: this.controlState,
            degradedCount: status.degradedCount,
            gatewayRunning: status.gatewayRunning,
            host: status.host,
            model: status.model ? this.modelStatusSnapshot(status) : undefined,
            port: status.port,
            startedAt: status.startedAt,
            streamingCount: status.streamingCount,
            uptimeMs: status.uptimeMs,
            url: status.url,
            cache: this.readCache.stats(),
            context: this.contextTelemetry(status),
        };
    }

    private contextTelemetry(status: SocketControlTransportStatusSnapshot): GatewayControlGatewayStatusSnapshot["context"] {
        const contextUsedTokens = this.contextUsedTokens(status.context);
        const contextWindowTokens = status.model ? this.resolveContextWindowTokens(status.model) : null;
        const contextWindowPercent = this.contextWindowPercent(contextUsedTokens, contextWindowTokens);
        const remainingContextTokens = contextUsedTokens !== null && contextWindowTokens !== null
            ? Math.max(0, contextWindowTokens - contextUsedTokens)
            : null;
        return {
            compressionThresholdTokens: this.nullableNonNegativeInteger(status.context?.compressionThresholdTokens),
            contextStatus: contextUsedTokens === null ? "unknown" : "available",
            contextUsedTokens,
            contextWindowPercent,
            currentTokens: contextUsedTokens,
            hotContextTokens: contextUsedTokens,
            remainingContextTokens,
        };
    }

    private modelStatusSnapshot(status: SocketControlTransportStatusSnapshot): GatewayControlGatewayStatusSnapshot["model"] {
        if (!status.model) return undefined;
        const contextWindowTokens = this.resolveContextWindowTokens(status.model);
        const contextUsedTokens = this.contextUsedTokens(status.context);
        return {
            contextStatus: contextUsedTokens === null ? "unknown" : "available",
            contextUsedTokens,
            contextWindowPercent: this.contextWindowPercent(contextUsedTokens, contextWindowTokens),
            contextWindowTokens,
            currentTokens: contextUsedTokens,
            maxOutputTokens: status.model.maxTokens,
            model: status.model.model,
            provider: status.model.provider,
            providerId: status.model.providerId,
        };
    }

    private contextUsedTokens(context: SocketControlContextTelemetrySnapshot | undefined): number | null {
        return this.nullableNonNegativeInteger(context?.contextUsedTokens)
            ?? this.nullableNonNegativeInteger(context?.currentTokens)
            ?? this.nullableNonNegativeInteger(context?.hotContextTokens);
    }

    private contextWindowPercent(usedTokens: number | null, windowTokens: number | null): number | null {
        return usedTokens !== null && windowTokens !== null && windowTokens > 0
            ? usedTokens / windowTokens
            : null;
    }

    private invalidateReadCache(): void {
        this.readCache.clear();
    }

    private readCacheKey(type: string, payload: unknown): string {
        return `${type}:${this.stableJson(payload ?? {})}`;
    }

    private readCacheMetadata(key: string, hit: boolean): GatewayControlReadCacheMetadata {
        return { hit, key, ttlMs: this.readCache.stats().ttlMs };
    }

    private withReadCacheHit(payload: Record<string, unknown>, key: string): Record<string, unknown> {
        const next: Record<string, unknown> = {
            ...payload,
            cache: this.readCacheMetadata(key, true),
        };
        if (this.isGatewayStatusPayload(payload)) {
            next.status = {
                ...payload.status,
                cache: this.readCache.stats(),
            };
        }
        return next;
    }

    private isGatewayStatusPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & {
        status: GatewayControlGatewayStatusSnapshot;
    } {
        return Boolean(payload.status && typeof payload.status === "object" && !Array.isArray(payload.status));
    }

    private resolveContextWindowTokens(model: ModelConfig): number | null {
        return this.nullablePositiveInteger(model.contextWindowTokens)
            ?? knownModelContextWindowTokens(model.providerId, model.model)
            ?? null;
    }

    private nullableNonNegativeInteger(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    }

    private nullablePositiveInteger(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    }

    private stableJson(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
        }
        if (value && typeof value === "object") {
            return `{${Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
                .join(",")}}`;
        }
        return JSON.stringify(value);
    }

    private isLocalRequest(request: Request): boolean {
        const url = new URL(request.url);
        return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    }

    private log(step: string, payload: Record<string, unknown> = {}): void {
        console.error(
            JSON.stringify({
                scope: "socket.control",
                step,
                ...payload,
            }),
        );
    }
}

export type GatewayControlHubOptions = SocketControlHubOptions;
export type GatewayControlDispatchOptions = SocketControlDispatchOptions;
export type GatewayControlTransportChannelStatusSnapshot = SocketControlTransportChannelStatusSnapshot;
export type GatewayControlTransportStatusSnapshot = SocketControlTransportStatusSnapshot;
export type GatewayControlMessageDispatcher = SocketControlMessageDispatcher;
export const GatewayControlHub = SocketControlHub;

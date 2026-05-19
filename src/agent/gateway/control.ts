import type { GatewayConfig } from "../../config/index.ts";
import {
    createGatewayControlEnvelope,
    createGatewayControlEventEnvelope,
    normalizeGatewayControlMessage,
    parseGatewayControlEnvelope,
    readGatewayControlMessageInput,
    readGatewayControlSubscription,
    shouldDeliverGatewayControlEvent,
    type GatewayControlEnvelope,
    type GatewayControlPeer,
    type GatewayControlSocket,
} from "../../protocol/control/index.ts";
import {
    GatewayControlMessageType,
    type GatewayMessage,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink, type RuntimeEventBus } from "../../events/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import { buildBuiltinExternalKitCatalog, loadExternalKitCatalogSnapshot } from "./kit/index.ts";
import type { GatewayStatusSnapshot } from "./channels/status.ts";
import type { StreamingMessageDispatcher } from "./channels/types.ts";

export type { GatewayControlPeer };

export interface GatewayControlHubOptions {
    config: GatewayConfig;
    dispatch: StreamingMessageDispatcher;
    events: RuntimeEventBus;
    paths?: FlyflorPaths;
    status: () => GatewayStatusSnapshot;
}

type GatewayControlHandler = (
    socket: GatewayControlSocket,
    envelope: GatewayControlEnvelope,
) => void | Promise<void>;

/**
 * WebSocket control/event transport for first-party clients.
 *
 * This hub is intentionally generic: it exposes structured gateway commands,
 * runtime event subscriptions and turn deltas over one envelope protocol. TUI,
 * web consoles and future local apps should consume this surface instead of
 * adding terminal-specific branches inside GatewayModule.
 */
export class GatewayControlHub implements EventSink {
    private readonly clients = new Set<GatewayControlSocket>();
    private readonly handlers = new Map<string, GatewayControlHandler>();
    private capabilityCatalog: Record<string, unknown> | null = null;
    private readonly unsubscribeEvents: () => void;

    public constructor(private readonly options: GatewayControlHubOptions) {
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
        this.handlers.set(GatewayControlMessageType.GatewayStatusGet, (socket, envelope) =>
            this.handleGatewayStatusGet(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.GatewayMessageSend, (socket, envelope) =>
            this.handleGatewayMessageSend(socket, envelope),
        );
        this.handlers.set(GatewayControlMessageType.Ping, (socket, envelope) => this.handlePing(socket, envelope));
        this.unsubscribeEvents = this.options.events.subscribe(this);
    }

    public upgrade(request: Request, server: Bun.Server<GatewayControlPeer>): Response | undefined {
        if (!this.authorize(request)) {
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
        return ok ? undefined : new Response("gateway control upgrade failed", { status: 400 });
    }

    public open(socket: GatewayControlSocket): void {
        this.clients.add(socket);
        void this.sendServerHello(socket).catch((error) => this.sendError(socket, undefined, error));
    }

    public close(socket: GatewayControlSocket): void {
        this.clients.delete(socket);
    }

    public async message(socket: GatewayControlSocket, raw: string | Buffer): Promise<void> {
        let envelope: GatewayControlEnvelope;
        try {
            envelope = parseGatewayControlEnvelope(raw);
        } catch (error) {
            this.sendError(socket, undefined, error);
            return;
        }
        const handler = this.handlers.get(envelope.type);
        if (!handler) {
            this.sendError(socket, envelope, new Error(`Unsupported gateway control message: ${envelope.type}`));
            return;
        }
        try {
            await handler(socket, envelope);
        } catch (error) {
            this.sendError(socket, envelope, error);
        }
    }

    public publish(event: RuntimeEvent): void {
        if (event.type === RuntimeEventType.CttlCapabilityCatalogBuilt && event.payload) {
            this.capabilityCatalog = event.payload;
        }
        const envelope = createGatewayControlEventEnvelope(event);
        for (const client of this.clients) {
            if (shouldDeliverGatewayControlEvent(event, client.data.subscriptions)) {
                client.send(JSON.stringify(envelope));
            }
        }
    }

    public dispose(): void {
        this.unsubscribeEvents();
        for (const client of this.clients) {
            client.close();
        }
        this.clients.clear();
    }

    private handleClientHello(socket: GatewayControlSocket, envelope: GatewayControlEnvelope): void {
        this.send(socket, GatewayControlMessageType.Ack, {
            clientId: socket.data.clientId,
            received: envelope.type,
        }, envelope);
    }

    private async handleCapabilityCatalogGet(
        socket: GatewayControlSocket,
        envelope: GatewayControlEnvelope,
    ): Promise<void> {
        const kits = this.options.paths
            ? await loadExternalKitCatalogSnapshot(this.options.paths)
            : buildBuiltinExternalKitCatalog();
        this.send(socket, GatewayControlMessageType.CapabilityCatalogSnapshot, {
            catalog: this.capabilityCatalog,
            kits,
        }, envelope);
    }

    private handleEventSubscribe(socket: GatewayControlSocket, envelope: GatewayControlEnvelope): void {
        const subscription = readGatewayControlSubscription(envelope.payload);
        socket.data.subscriptions = [...socket.data.subscriptions, subscription];
        this.send(socket, GatewayControlMessageType.Ack, {
            subscriptions: socket.data.subscriptions,
        }, envelope);
    }

    private handleEventUnsubscribe(socket: GatewayControlSocket, envelope: GatewayControlEnvelope): void {
        const subscription = readGatewayControlSubscription(envelope.payload);
        socket.data.subscriptions = socket.data.subscriptions.filter((candidate) => {
            if (subscription.requestId && candidate.requestId !== subscription.requestId) return true;
            if (subscription.types && subscription.types.length > 0) {
                const types = candidate.types ?? [];
                return !types.some((type) => subscription.types?.includes(type));
            }
            return false;
        });
        this.send(socket, GatewayControlMessageType.Ack, {
            subscriptions: socket.data.subscriptions,
        }, envelope);
    }

    private handleGatewayStatusGet(socket: GatewayControlSocket, envelope: GatewayControlEnvelope): void {
        this.send(socket, GatewayControlMessageType.GatewayStatusSnapshot, {
            status: this.options.status(),
        }, envelope);
    }

    private async handleGatewayMessageSend(
        socket: GatewayControlSocket,
        envelope: GatewayControlEnvelope,
    ): Promise<void> {
        const input = readGatewayControlMessageInput(envelope.payload);
        const context = this.contextFromInput(input.context);
        const gatewayMessage = this.messageFromInput(input);
        try {
            const reply = await this.options.dispatch(gatewayMessage, {
                context,
                onTextDelta: (delta) => {
                    this.send(socket, GatewayControlMessageType.TurnDelta, {
                        delta,
                        messageId: gatewayMessage.id,
                    }, envelope, context.requestId);
                },
            });
            this.send(socket, GatewayControlMessageType.TurnFinal, {
                reply,
            }, envelope, context.requestId);
        } catch (error) {
            this.send(socket, GatewayControlMessageType.TurnError, {
                message: error instanceof Error ? error.message : String(error),
                messageId: gatewayMessage.id,
            }, envelope, context.requestId);
        }
    }

    private handlePing(socket: GatewayControlSocket, envelope: GatewayControlEnvelope): void {
        this.send(socket, GatewayControlMessageType.Pong, {
            now: new Date().toISOString(),
        }, envelope);
    }

    private messageFromInput(input: ReturnType<typeof readGatewayControlMessageInput>): GatewayMessage {
        return normalizeGatewayControlMessage(input);
    }

    private contextFromInput(input: ReturnType<typeof readGatewayControlMessageInput>["context"]): RuntimeContext {
        return {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
            activeProject: input?.activeProject,
            contextForkId: input?.contextForkId,
            skillNames: input?.skillNames,
        };
    }

    private send<TPayload extends Record<string, unknown>>(
        socket: GatewayControlSocket,
        type: Parameters<typeof createGatewayControlEnvelope<TPayload>>[0],
        payload?: TPayload,
        source?: GatewayControlEnvelope,
        requestId?: string,
    ): void {
        socket.send(
            JSON.stringify(
                createGatewayControlEnvelope(type, payload, {
                    correlationId: source?.id,
                    requestId: requestId ?? source?.requestId,
                }),
            ),
        );
    }

    private async sendServerHello(socket: GatewayControlSocket): Promise<void> {
        const kits = this.options.paths
            ? await loadExternalKitCatalogSnapshot(this.options.paths)
            : buildBuiltinExternalKitCatalog();
        this.send(socket, GatewayControlMessageType.ServerHello, {
            clientId: socket.data.clientId,
            connectedAt: socket.data.connectedAt,
            capabilities: {
                commands: [...this.handlers.keys()],
                eventStream: true,
                protocol: "flyflor.ws.v1",
            },
            kits,
            status: this.options.status(),
        });
    }

    private sendError(socket: GatewayControlSocket, source: GatewayControlEnvelope | undefined, cause: unknown): void {
        this.send(socket, GatewayControlMessageType.Error, {
            message: cause instanceof Error ? cause.message : String(cause),
        }, source);
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

    private isLocalRequest(request: Request): boolean {
        const url = new URL(request.url);
        return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    }
}

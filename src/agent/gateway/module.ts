import type { GatewayConfig } from "../../config/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import { Gateway } from "../../components/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import { Module } from "../di/decorators/index.ts";
import type {
    ChannelName,
    GatewayMessage,
    GatewayReply,
    RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { Channel, ChannelLinkState, ChannelTransport } from "../../protocol/contracts/index.ts";
import type { RuntimeModule } from "../runtime/index.ts";
import { GatewayControlHub, type GatewayControlTransportStatusSnapshot, type GatewayControlPeer } from "./control.ts";
import { buildDedupKey, InMemoryDedupStore, type MessageDedupStore } from "./dedup.store.ts";

export interface GatewayModuleOptions {
    dedup?: MessageDedupStore;
    paths?: FlyflorPaths;
}

@Module()
export class GatewayModule extends Gateway {
    protected running = false;
    protected server?: Bun.Server<GatewayControlPeer>;
    protected serverUrl?: string;
    protected startedAt?: string;
    protected controlHub?: GatewayControlHub;

    protected readonly dedup: MessageDedupStore;
    protected readonly paths?: FlyflorPaths;

    public constructor(
        protected readonly config: GatewayConfig,
        protected readonly runtime: RuntimeModule,
        protected readonly events: EventSink,
        options: GatewayModuleOptions | MessageDedupStore = {},
    ) {
        super();
        this.dedup = isGatewayModuleOptions(options) ? options.dedup ?? new InMemoryDedupStore() : options;
        this.paths = isGatewayModuleOptions(options) ? options.paths : undefined;
    }

    public start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.startedAt = new Date().toISOString();
        this.controlHub = new GatewayControlHub({
            config: this.config,
            dispatch: (message, options) => this.dispatch(message, options),
            events: { subscribe: (sink: EventSink) => this.subscribeEvents(sink) } as never,
            paths: this.paths,
            status: () => this.getStatusSnapshot(),
        });
        this.server = Bun.serve<GatewayControlPeer>({
            hostname: this.config.host,
            port: this.config.port,
            fetch: (request, server) => this.handleRequest(request, server),
            websocket: {
                close: (socket) => this.controlHub?.close(socket),
                message: (socket, raw) => void this.controlHub?.message(socket, raw),
                open: (socket) => this.controlHub?.open(socket),
            },
        });
        this.serverUrl = this.server.url.toString();
        this.events.publish(event(RuntimeEventType.GatewayStart, { url: this.serverUrl }));
        void this.runtime.warmup?.();
    }

    public stop(): void {
        if (!this.running) {
            return;
        }
        this.controlHub?.dispose();
        this.controlHub = undefined;
        this.server?.stop(true);
        this.server = undefined;
        this.running = false;
    }

    public getStatusSnapshot(): GatewayControlTransportStatusSnapshot {
        const url = this.serverUrl;
        return {
            channels: [
                {
                    adapter: "GatewayControlHub",
                    capabilities: {
                        cardUpdate: false,
                        finalReply: true,
                        messageUpdate: false,
                        reactions: false,
                        replyReference: true,
                        thread: true,
                        topicCreate: false,
                        typing: true,
                    },
                    configured: true,
                    connected: this.running,
                    implemented: true,
                    name: Channel.Ws,
                    state: this.running ? ChannelLinkState.Connected : ChannelLinkState.Waiting,
                    streaming: true,
                    transport: ChannelTransport.Websocket,
                },
            ],
            connectedCount: this.running ? 1 : 0,
            degradedCount: 0,
            gatewayRunning: this.running,
            host: this.config.host,
            port: this.server?.port ?? this.config.port,
            startedAt: this.startedAt,
            streamingCount: this.running ? 1 : 0,
            uptimeMs: this.startedAt ? Date.now() - Date.parse(this.startedAt) : undefined,
            url,
        };
    }

    protected async handleRequest(
        request: Request,
        server?: Bun.Server<GatewayControlPeer>,
    ): Promise<Response | undefined> {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/ws") {
            if (!server || !this.controlHub) {
                return json({ error: "gateway_control_not_ready" }, 503);
            }
            return this.controlHub.upgrade(request, server);
        }
        if (request.method === "GET" && url.pathname === "/health") {
            return json({ ok: true });
        }
        if (request.method === "GET" && url.pathname === "/channels") {
            return json({
                gateway: this.getStatusSnapshot(),
                channels: this.getStatusSnapshot().channels,
            });
        }
        return json({ error: "not_found" }, 404);
    }

    protected async dispatch(
        message: GatewayMessage,
        options: { context?: RuntimeContext; onTextDelta?: (text: string) => void | Promise<void> } = {},
    ): Promise<GatewayReply> {
        const context: RuntimeContext = options.context ?? {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        };
        const dedupKey = buildDedupKey(message.route.channel, message.id);
        const claim = await this.dedup.tryClaim(dedupKey);
        if (claim.state === "duplicate") {
            this.events.publish(
                event(RuntimeEventType.GatewayMessageReceived, { channel: message.route.channel, dedup: "duplicate" }, context.requestId),
            );
            return claim.cachedReply;
        }
        if (claim.state === "in-flight") {
            this.events.publish(
                event(RuntimeEventType.GatewayMessageReceived, { channel: message.route.channel, dedup: "in-flight" }, context.requestId),
            );
            return {
                messageId: message.id,
                route: message.route,
                text: "",
                metadata: { dedup: "in-flight" },
            };
        }
        this.events.publish(
            event(RuntimeEventType.GatewayMessageReceived, { channel: message.route.channel, dedup: "claimed" }, context.requestId),
        );
        try {
            const reply = await this.runtime.handleMessage(message, context, options);
            await this.recordDedupReply(dedupKey, reply, message.route.channel, context.requestId);
            return reply;
        } catch (error) {
            await this.releaseDedupClaim(dedupKey, message.route.channel, context.requestId);
            throw error;
        }
    }

    protected async recordDedupReply(
        key: string,
        reply: GatewayReply,
        channel: ChannelName,
        requestId: string,
    ): Promise<void> {
        try {
            await this.dedup.recordReply(key, reply);
        } catch (error) {
            this.publishDedupStoreFailure("recordReply", key, channel, requestId, error);
        }
    }

    protected async releaseDedupClaim(key: string, channel: ChannelName, requestId: string): Promise<void> {
        try {
            await this.dedup.release(key);
        } catch (error) {
            this.publishDedupStoreFailure("release", key, channel, requestId, error);
        }
    }

    protected publishDedupStoreFailure(
        operation: "recordReply" | "release",
        key: string,
        channel: ChannelName,
        requestId: string,
        error: unknown,
    ): void {
        this.events.publish(
            event(
                RuntimeEventType.GatewayDedupStoreFailed,
                {
                    channel,
                    key,
                    message: error instanceof Error ? error.message : String(error),
                    operation,
                },
                requestId,
            ),
        );
    }

    private subscribeEvents(sink: EventSink): () => void {
        const maybeSubscribe = this.events as EventSink & { subscribe?: (sink: EventSink) => () => void };
        if (typeof maybeSubscribe.subscribe === "function") {
            return maybeSubscribe.subscribe(sink);
        }
        return () => undefined;
    }
}

function isGatewayModuleOptions(value: GatewayModuleOptions | MessageDedupStore): value is GatewayModuleOptions {
    return "dedup" in value || "paths" in value;
}

function json(payload: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

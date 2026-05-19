import type { GatewayConfig } from "../../config/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import type { RuntimeModule } from "../runtime/index.ts";
import {
    ChannelLinkState,
    type ChannelName,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { event, globalEvents, RuntimeEventType, type EventSink } from "../../events/index.ts";
import { Gateway } from "../../components/index.ts";
import { Module } from "../di/decorators/index.ts";
import { buildGatewayStatusSnapshot, type ChannelRuntimeState } from "./channels/status.ts";
import type { ChannelAdapter, StreamingDispatchOptions, StreamingMessageDispatcher } from "./channels/types.ts";
import { GatewayControlHub, type GatewayControlPeer } from "./control.ts";
import { buildDedupKey, InMemoryDedupStore, type MessageDedupStore } from "./dedup.ts";

export interface GatewayModuleOptions {
    dedup?: MessageDedupStore;
    paths?: FlyflorPaths;
}

@Module()
export class GatewayModule extends Gateway {
    protected readonly channelRuntime = new Map<ChannelName, ChannelRuntimeState>();
    protected running = false;
    protected server?: Bun.Server<GatewayControlPeer>;
    protected serverUrl?: string;
    protected startedAt?: string;
    protected controlHub?: GatewayControlHub;

    public constructor(
        protected readonly config: GatewayConfig,
        protected readonly adapters: Map<ChannelName, ChannelAdapter>,
        protected readonly runtime: RuntimeModule,
        protected readonly events: EventSink,
        options: GatewayModuleOptions | MessageDedupStore = {},
    ) {
        super();
        this.dedup = isGatewayModuleOptions(options)
            ? options.dedup ?? new InMemoryDedupStore()
            : options;
        this.paths = isGatewayModuleOptions(options) ? options.paths : undefined;
    }

    protected readonly dedup: MessageDedupStore;
    protected readonly paths?: FlyflorPaths;

    public start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.startedAt = new Date().toISOString();
        this.controlHub = new GatewayControlHub({
            config: this.config,
            dispatch: this.createTrackedDispatcher("ws"),
            events: globalEvents,
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

        this.events.publish(event(RuntimeEventType.GatewayStart, { url: this.server.url.toString() }));

        // Component warmup is fire-and-forget; first real turn still awaits the
        // same promise, but gateway startup does not block on local store recovery.
        void this.runtime.warmup?.();

        for (const adapter of this.adapters.values()) {
            void adapter.start?.(this.createTrackedDispatcher(adapter.name));
        }

        if (this.config.stdio) {
            void this.startStdio();
        }
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

    protected async handleRequest(request: Request, server?: Bun.Server<GatewayControlPeer>): Promise<Response | undefined> {
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
            const snapshot = this.getStatusSnapshot();
            return json({
                gateway: {
                    running: snapshot.gatewayRunning,
                    startedAt: snapshot.startedAt,
                    url: snapshot.url,
                    uptimeMs: snapshot.uptimeMs,
                },
                channels: snapshot.channels,
            });
        }

        if (url.pathname.startsWith("/v1/")) {
            return this.dispatchHttp("api", request);
        }

        if (request.method === "POST" && url.pathname === "/chat") {
            return this.dispatchHttp("webhook", request);
        }

        if (request.method === "POST" && url.pathname === "/chat/stream") {
            return this.dispatchHttpStream("webhook", request);
        }

        const webhookMatch = /^\/webhook\/([a-z0-9_-]+)$/.exec(url.pathname);
        if ((request.method === "POST" || request.method === "GET") && webhookMatch) {
            return this.dispatchHttp(webhookMatch[1] as ChannelName, request);
        }

        const streamMatch = /^\/webhook\/([a-z0-9_-]+)\/stream$/.exec(url.pathname);
        if (request.method === "POST" && streamMatch) {
            return this.dispatchHttpStream(streamMatch[1] as ChannelName, request);
        }

        return json({ error: "not_found" }, 404);
    }

    protected async dispatchHttp(channel: ChannelName, request: Request): Promise<Response> {
        const adapter = this.adapters.get(channel);
        if (!adapter) {
            return json({ error: "channel_not_enabled", channel }, 404);
        }

        try {
            return await adapter.handle(request, this.createTrackedDispatcher(channel));
        } catch (error) {
            this.markChannelRuntime(channel, {
                lastError: errorMessage(error),
                lastErrorAt: new Date().toISOString(),
                state: ChannelLinkState.Degraded,
                streaming: false,
            });
            return json(
                {
                    error: "gateway_dispatch_failed",
                    message: errorMessage(error),
                },
                502,
            );
        }
    }

    protected async dispatchHttpStream(channel: ChannelName, request: Request): Promise<Response> {
        const adapter = this.adapters.get(channel);
        const normalizer = adapter as { normalize?: (input: unknown) => GatewayMessage };
        if (!adapter || typeof normalizer.normalize !== "function") {
            return json({ error: "channel_stream_not_enabled", channel }, 404);
        }

        const payload = await request.json().catch(() => undefined);
        const message = normalizer.normalize(payload);
        // Historical channel stream URLs are kept for client compatibility, but
        // channel delivery is final-only: no model deltas leave the gateway.
        const reply = await this.createTrackedDispatcher(channel)(message);
        return new Response(reply.text, {
            headers: {
                "cache-control": "no-cache",
                "content-type": "text/plain; charset=utf-8",
            },
        });
    }

    protected async dispatch(
        message: GatewayMessage,
        options: StreamingDispatchOptions = {},
    ) {
        const context: RuntimeContext = options.context ?? {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        };
        // 跨副本幂等：同一 (channel, message.id) 第二次进入直接复用第一次结果，
        // in-flight 重复请求短路返回空文 reply（webhook 上游会收到 200 不再重试）。
        const dedupKey = buildDedupKey(message.route.channel, message.id);
        const claim = await this.dedup.tryClaim(dedupKey);
        if (claim.state === "duplicate") {
            this.events.publish(
                event(
                    RuntimeEventType.GatewayMessageReceived,
                    { channel: message.route.channel, dedup: "duplicate" },
                    context.requestId,
                ),
            );
            return claim.cachedReply;
        }
        if (claim.state === "in-flight") {
            this.events.publish(
                event(
                    RuntimeEventType.GatewayMessageReceived,
                    { channel: message.route.channel, dedup: "in-flight" },
                    context.requestId,
                ),
            );
            return {
                messageId: message.id,
                route: message.route,
                text: "",
                metadata: { dedup: "in-flight" },
            } satisfies GatewayReply;
        }
        this.events.publish(
            event(
                RuntimeEventType.GatewayMessageReceived,
                { channel: message.route.channel, dedup: "claimed" },
                context.requestId,
            ),
        );
        try {
            const reply = await this.runtime.handleMessage(message, context, options);
            await this.recordDedupReply(dedupKey, reply, message.route.channel, context.requestId);
            return reply;
        } catch (err) {
            await this.releaseDedupClaim(dedupKey, message.route.channel, context.requestId);
            throw err;
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
        // Dedup storage protects upstream retry idempotency, but it must never
        // hide the user-visible runtime result. Emit structured telemetry so
        // degraded external stores are observable without blocking final reply.
        this.events.publish(
            event(
                RuntimeEventType.GatewayDedupStoreFailed,
                {
                    channel,
                    error: errorMessage(error),
                    key,
                    operation,
                },
                requestId,
            ),
        );
    }

    public getStatusSnapshot() {
        return buildGatewayStatusSnapshot(
            this.config,
            this.adapters,
            this.channelRuntime,
            this.running,
            this.startedAt,
            this.serverUrl,
        );
    }

    protected createTrackedDispatcher(channel: ChannelName): StreamingMessageDispatcher {
        return async (message, options = {}) => {
            const startedAt = new Date().toISOString();
            this.markChannelRuntime(channel, {
                connected: true,
                detail: `${message.route.chatType}:${message.route.chatId}`,
                lastInboundAt: startedAt,
                state: ChannelLinkState.Processing,
                streaming: false,
            });

            let emittedDelta = false;
            try {
                const reply = await this.dispatch(message, {
                    context: options.context,
                    onTextDelta: async (text) => {
                        if (!emittedDelta) {
                            emittedDelta = true;
                            this.markChannelRuntime(channel, {
                                state: ChannelLinkState.Replying,
                                streaming: true,
                            });
                        }
                        await options.onTextDelta?.(text);
                    },
                });
                this.markChannelRuntime(channel, {
                    connected: true,
                    lastError: undefined,
                    lastErrorAt: undefined,
                    lastOutboundAt: new Date().toISOString(),
                    state: ChannelLinkState.Connected,
                    streaming: false,
                });
                return reply;
            } catch (error) {
                this.markChannelRuntime(channel, {
                    lastError: errorMessage(error),
                    lastErrorAt: new Date().toISOString(),
                    state: ChannelLinkState.Degraded,
                    streaming: false,
                });
                throw error;
            }
        };
    }

    protected markChannelRuntime(channel: ChannelName, patch: Partial<ChannelRuntimeState>): void {
        const current = this.channelRuntime.get(channel) ?? {};
        const next = { ...current, ...patch };
        this.channelRuntime.set(channel, next);
        // 状态切换才广播 ChannelLinkChanged（避免高频心跳噪声）。
        if (patch.state !== undefined && current.state !== patch.state) {
            this.events.publish(
                event(RuntimeEventType.ChannelLinkChanged, {
                    channel,
                    from: current.state,
                    to: patch.state,
                    detail: next.detail,
                }),
            );
        }
        // lastError 首次出现 / 文本变化时广播 ChannelError。
        if (patch.lastError && patch.lastError !== current.lastError) {
            this.events.publish(
                event(RuntimeEventType.ChannelError, {
                    channel,
                    error: patch.lastError,
                    at: patch.lastErrorAt ?? new Date().toISOString(),
                }),
            );
        }
    }

    protected async startStdio(): Promise<void> {
        const adapter = this.adapters.get("stdio");
        if (!adapter) {
            return;
        }

        for await (const line of console) {
            const text = String(line).trim();
            if (!text) {
                continue;
            }
            if (!("normalize" in adapter) || typeof adapter.normalize !== "function") {
                continue;
            }
            let wrote = false;
            await this.createTrackedDispatcher("stdio")(adapter.normalize(text), {
                onTextDelta: (delta) => {
                    wrote = true;
                    process.stdout.write(delta);
                },
            });
            if (wrote) {
                process.stdout.write("\n");
            }
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isGatewayModuleOptions(value: GatewayModuleOptions | MessageDedupStore): value is GatewayModuleOptions {
    return !("tryClaim" in value);
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

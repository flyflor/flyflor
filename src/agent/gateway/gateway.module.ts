import type { GatewayConfig } from "../../config/index.ts";
import type { RuntimeModule } from "../runtime/index.ts";
import {
    ChannelLinkState,
    ComponentKind,
    ArchitectureLayer,
    type ChannelName,
    type GatewayMessage,
    type RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { Gateway } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";
import { buildGatewayStatusSnapshot, type ChannelRuntimeState } from "./channels/status.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./channels/types.ts";

@Module({ name: "gateway", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Gateway, layer: ArchitectureLayer.Control, name: "gateway", provider: true })
export class GatewayModule extends Gateway {
    private readonly channelRuntime = new Map<ChannelName, ChannelRuntimeState>();
    private running = false;
    private serverUrl?: string;
    private startedAt?: string;

    constructor(
        private readonly config: GatewayConfig,
        private readonly adapters: Map<ChannelName, ChannelAdapter>,
        private readonly runtime: RuntimeModule,
        private readonly events: EventSink,
    ) {
        super();
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.startedAt = new Date().toISOString();
        const server = Bun.serve({
            hostname: this.config.host,
            port: this.config.port,
            fetch: (request) => this.handleRequest(request),
        });
        this.serverUrl = server.url.toString();

        this.events.publish(event(RuntimeEventType.GatewayStart, { url: server.url.toString() }));

        for (const adapter of this.adapters.values()) {
            void adapter.start?.(this.createTrackedDispatcher(adapter.name));
        }

        if (this.config.stdio) {
            void this.startStdio();
        }
    }

    private async handleRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);
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

    private async dispatchHttp(channel: ChannelName, request: Request): Promise<Response> {
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

    private async dispatchHttpStream(channel: ChannelName, request: Request): Promise<Response> {
        const adapter = this.adapters.get(channel);
        const normalizer = adapter as { normalize?: (input: unknown) => GatewayMessage };
        if (!adapter || typeof normalizer.normalize !== "function") {
            return json({ error: "channel_stream_not_enabled", channel }, 404);
        }

        const payload = await request.json().catch(() => undefined);
        const message = normalizer.normalize(payload);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                let wroteDelta = false;
                void this.createTrackedDispatcher(channel)(message, {
                    onTextDelta: (text) => {
                        wroteDelta = true;
                        controller.enqueue(encoder.encode(text));
                    },
                })
                    .then((reply) => {
                        if (!wroteDelta && reply.text) {
                            controller.enqueue(encoder.encode(reply.text));
                        }
                        controller.close();
                    })
                    .catch((error) => {
                        controller.enqueue(encoder.encode(`Flyflor gateway error: ${errorMessage(error)}\n`));
                        controller.close();
                    });
            },
        });
        return new Response(stream, {
            headers: {
                "cache-control": "no-cache",
                "content-type": "text/plain; charset=utf-8",
            },
        });
    }

    private async dispatch(
        message: GatewayMessage,
        options: { onTextDelta?: (text: string) => void | Promise<void> } = {},
    ) {
        const context: RuntimeContext = {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        };
        this.events.publish(
            event(RuntimeEventType.GatewayMessageReceived, { channel: message.route.channel }, context.requestId),
        );
        return this.runtime.handleMessage(message, context, options);
    }

    getStatusSnapshot() {
        return buildGatewayStatusSnapshot(
            this.config,
            this.adapters,
            this.channelRuntime,
            this.running,
            this.startedAt,
            this.serverUrl,
        );
    }

    private createTrackedDispatcher(channel: ChannelName): StreamingMessageDispatcher {
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

    private markChannelRuntime(channel: ChannelName, patch: Partial<ChannelRuntimeState>): void {
        const current = this.channelRuntime.get(channel) ?? {};
        this.channelRuntime.set(channel, {
            ...current,
            ...patch,
        });
    }

    private async startStdio(): Promise<void> {
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

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

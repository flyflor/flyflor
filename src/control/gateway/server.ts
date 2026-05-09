import type { GatewayConfig } from "../../config/index.ts";
import type { AgentRuntime } from "../runtime/index.ts";
import type { ChannelName, GatewayMessage, RuntimeContext } from "../../fpc/contracts/index.ts";
import { event, FpcEventType, type EventSink } from "../../fpc/events/index.ts";
import { Gateway } from "../../fpc/decorators/index.ts";
import type { ChannelAdapter } from "./channels/types.ts";

@Gateway()
export class GatewayServer {
    constructor(
        private readonly config: GatewayConfig,
        private readonly adapters: Map<ChannelName, ChannelAdapter>,
        private readonly runtime: AgentRuntime,
        private readonly events: EventSink,
    ) {}

    start(): void {
        const server = Bun.serve({
            hostname: this.config.host,
            port: this.config.port,
            fetch: (request) => this.handleRequest(request),
        });

        this.events.publish(event(FpcEventType.GatewayStart, { url: server.url.toString() }));

        for (const adapter of this.adapters.values()) {
            void adapter.start?.((message) => this.dispatch(message));
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
            return json({ channels: [...this.adapters.keys()] });
        }

        if (request.method === "POST" && url.pathname === "/chat") {
            return this.dispatchHttp("webhook", request);
        }

        const webhookMatch = /^\/webhook\/([a-z0-9_-]+)$/.exec(url.pathname);
        if ((request.method === "POST" || request.method === "GET") && webhookMatch) {
            return this.dispatchHttp(webhookMatch[1] as ChannelName, request);
        }

        return json({ error: "not_found" }, 404);
    }

    private async dispatchHttp(channel: ChannelName, request: Request): Promise<Response> {
        const adapter = this.adapters.get(channel);
        if (!adapter) {
            return json({ error: "channel_not_enabled", channel }, 404);
        }

        return adapter.handle(request, (message) => this.dispatch(message));
    }

    private async dispatch(message: GatewayMessage) {
        const context: RuntimeContext = {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        };
        this.events.publish(
            event(FpcEventType.GatewayMessageReceived, { channel: message.route.channel }, context.requestId),
        );
        return this.runtime.handleMessage(message, context);
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
            const reply = await this.dispatch(adapter.normalize(text));
            console.log(reply.text);
        }
    }
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

import { describe, expect, test } from "bun:test";
import { SocketModule } from "../src/socket/module.ts";
import type { GatewayConfig, ModelConfig } from "../src/config/index.ts";
import {
    Channel,
    GatewayControlMessageType,
    RuntimeEventType,
    type EventSink,
    type RuntimeEvent,
} from "../src/protocol/index.ts";
import type { GatewayControlPeer } from "../src/socket/control.ts";

class NullSink implements EventSink {
    public publish(_event: RuntimeEvent): void {}
}

class CollectSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

class FakeUpgradeServer {
    public upgradeCalls = 0;

    public upgrade(_request: Request, _options: { data: GatewayControlPeer }): boolean {
        this.upgradeCalls += 1;
        return true;
    }

    public asBunServer(): Bun.Server<GatewayControlPeer> & { upgradeCalls: number } {
        return this as unknown as Bun.Server<GatewayControlPeer> & { upgradeCalls: number };
    }
}

describe("SocketModule minimal vascular surface", () => {
    test("GET /health returns ok without runtime involvement", async () => {
        const socketModule = createSocketModule();

        const response = await openHandleRequest(socketModule, new Request("http://127.0.0.1/health"));

        expect(response?.status).toBe(200);
        await expect(response?.json()).resolves.toEqual({ ok: true });
    });

    test("GET /ws returns 503 before SocketControlHub is started", async () => {
        const socketModule = createSocketModule();
        const server = new FakeUpgradeServer();

        const response = await openHandleRequest(socketModule, new Request("http://127.0.0.1/ws"), server.asBunServer());

        expect(response?.status).toBe(503);
        await expect(response?.json()).resolves.toEqual({ error: "gateway_control_not_ready" });
        expect(server.upgradeCalls).toBe(0);
    });

    test("GET /ws upgrades when SocketControlHub is ready", async () => {
        const socketModule = createSocketModule();
        const server = new FakeUpgradeServer();
        (
            socketModule as unknown as {
                controlHub: {
                    upgrade(request: Request, server: Bun.Server<GatewayControlPeer>): Response | undefined;
                };
            }
        ).controlHub = {
            upgrade: (request: Request, bunServer: Bun.Server<GatewayControlPeer>) =>
                bunServer.upgrade(request, {
                    data: {
                        clientId: "test-client",
                        connectedAt: "2026-05-22T00:00:00.000Z",
                        subscriptions: [],
                    },
                })
                    ? undefined
                    : new Response("upgrade failed", { status: 400 }),
        };

        const response = await openHandleRequest(socketModule, new Request("http://127.0.0.1/ws"), server.asBunServer());

        expect(response).toBeUndefined();
        expect(server.upgradeCalls).toBe(1);
    });

    test("unknown route returns structured 404 json", async () => {
        const socketModule = createSocketModule();

        const response = await openHandleRequest(socketModule, new Request("http://127.0.0.1/unknown"));

        expect(response?.status).toBe(404);
        await expect(response?.json()).resolves.toEqual({ error: "not_found" });
    });

    test("GET /channels now returns not found", async () => {
        const socketModule = createSocketModule();

        const response = await openHandleRequest(socketModule, new Request("http://127.0.0.1/channels"));

        expect(response?.status).toBe(404);
        await expect(response?.json()).resolves.toEqual({ error: "not_found" });
    });

    test("status snapshot carries configured model cap without context-window fallback", () => {
        const socketModule = createSocketModule({ model: modelConfig() });

        expect(socketModule.getStatusSnapshot()).toMatchObject({
            context: {
                compressionThresholdTokens: null,
                hotContextTokens: null,
            },
            model: {
                contextWindowTokens: 64000,
                maxTokens: 2048,
                model: "demo-model",
                providerId: "custom",
            },
        });
    });

    test("control hub can publish yolo audit events through the socket event bridge", async () => {
        const events = new CollectSink();
        const socketModule = createSocketModule({ events });
        const dispatches: Array<{ options?: { sandboxMode?: string } }> = [];
        (
            socketModule as unknown as {
                runtime: {
                    handleMessage(
                        message: unknown,
                        context: unknown,
                        options?: { sandboxMode?: string },
                    ): Promise<{ messageId: string; route: unknown; text: string }>;
                };
            }
        ).runtime = {
            handleMessage: async (message: { id: string; route: unknown }, _context, options) => {
                dispatches.push({ options });
                return { messageId: message.id, route: message.route, text: "ok" };
            },
        };
        socketModule.start();
        const url = `ws://127.0.0.1:${socketModule.getStatusSnapshot().port}/ws`;
        const socket = new WebSocket(url);
        const messages: Array<Record<string, unknown>> = [];
        socket.addEventListener("message", (message) => {
            messages.push(JSON.parse(String(message.data)) as Record<string, unknown>);
        });

        await waitForOpen(socket);
        socket.send(JSON.stringify(envelope(GatewayControlMessageType.GatewayMessageSend, {
            metadata: { tui: { yolo: true } },
            text: "run with yolo",
        })));
        await waitForMessage(messages, GatewayControlMessageType.TurnFinal);
        socket.close();
        socketModule.stop();

        expect(dispatches[0]?.options?.sandboxMode).toBe("yolo");
        expect(events.events.map((event) => event.type)).toContain(RuntimeEventType.SandboxYoloEntered);
        expect(events.events.map((event) => event.type)).toContain(RuntimeEventType.SandboxYoloExited);
    });
});

function createSocketModule(options: { events?: EventSink; model?: ModelConfig } = {}): SocketModule {
    return new SocketModule(
        gatewayConfig(),
        {
            warmup: async () => undefined,
        } as never,
        options.events ?? new NullSink(),
        { model: options.model },
    );
}

function gatewayConfig(): GatewayConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        allowedChannels: [Channel.Stdio],
        channelReplyUrls: {},
        channels: {},
        stdio: false,
    } as GatewayConfig;
}

function modelConfig(): ModelConfig {
    return {
        apiMode: "chat-completions",
        baseUrl: "https://example.invalid/v1",
        headers: {},
        contextWindowTokens: 64000,
        maxTokens: 2048,
        model: "demo-model",
        provider: "openai-compatible",
        providerId: "custom",
        temperature: 0.2,
        timeoutMs: 60_000,
    } as ModelConfig;
}

async function openHandleRequest(
    socketModule: SocketModule,
    request: Request,
    server?: Bun.Server<GatewayControlPeer>,
): Promise<Response | undefined> {
    return (
        socketModule as unknown as {
            handleRequest(request: Request, server?: Bun.Server<GatewayControlPeer>): Promise<Response | undefined>;
        }
    ).handleRequest(request, server);
}

function envelope(type: string, payload: Record<string, unknown>): Record<string, unknown> {
    return {
        protocol: "flyflor.ws.v1",
        id: `test-${crypto.randomUUID()}`,
        type,
        at: new Date().toISOString(),
        requestId: `request-${crypto.randomUUID()}`,
        payload,
    };
}

async function waitForOpen(socket: WebSocket): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("websocket failed to open")), { once: true });
    });
}

async function waitForMessage(messages: readonly Record<string, unknown>[], type: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
        if (messages.some((message) => message.type === type)) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}`);
}

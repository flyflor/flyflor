import { describe, expect, test } from "bun:test";
import { SocketModule } from "../src/socket/module.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import { Channel, type EventSink, type RuntimeEvent } from "../src/protocol/index.ts";
import type { GatewayControlPeer } from "../src/socket/control.ts";

class NullSink implements EventSink {
    public publish(_event: RuntimeEvent): void {}
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
});

function createSocketModule(): SocketModule {
    return new SocketModule(
        gatewayConfig(),
        {
            warmup: async () => undefined,
        } as never,
        new NullSink(),
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

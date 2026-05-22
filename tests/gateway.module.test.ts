import { describe, expect, test } from "bun:test";
import { GatewayModule } from "../src/agent/gateway/module.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import { Channel, type EventSink, type RuntimeEvent } from "../src/protocol/index.ts";
import type { GatewayControlPeer } from "../src/agent/gateway/control.ts";

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

describe("GatewayModule minimal vascular surface", () => {
    test("GET /health returns ok without runtime involvement", async () => {
        const gateway = createGateway();

        const response = await openHandleRequest(gateway, new Request("http://127.0.0.1/health"));

        expect(response?.status).toBe(200);
        await expect(response?.json()).resolves.toEqual({ ok: true });
    });

    test("GET /channels returns the minimal gateway status snapshot", async () => {
        const gateway = createGateway();

        const response = await openHandleRequest(gateway, new Request("http://127.0.0.1/channels"));
        const body = (await response?.json()) as {
            gateway: { clientCount: number; gatewayRunning: boolean; channels: Array<{ name: string }> };
            channels: Array<{ name: string }>;
        };

        expect(response?.status).toBe(200);
        expect(body.gateway.clientCount).toBe(0);
        expect(body.gateway.gatewayRunning).toBe(false);
        expect(body.gateway.channels).toHaveLength(1);
        expect(body.gateway.channels[0]?.name).toBe(Channel.Ws);
        expect(body.channels).toEqual(body.gateway.channels);
    });

    test("GET /ws returns 503 before GatewayControlHub is started", async () => {
        const gateway = createGateway();
        const server = new FakeUpgradeServer();

        const response = await openHandleRequest(gateway, new Request("http://127.0.0.1/ws"), server.asBunServer());

        expect(response?.status).toBe(503);
        await expect(response?.json()).resolves.toEqual({ error: "gateway_control_not_ready" });
        expect(server.upgradeCalls).toBe(0);
    });

    test("unknown route returns structured 404 json", async () => {
        const gateway = createGateway();

        const response = await openHandleRequest(gateway, new Request("http://127.0.0.1/unknown"));

        expect(response?.status).toBe(404);
        await expect(response?.json()).resolves.toEqual({ error: "not_found" });
    });
});

function createGateway(): GatewayModule {
    return new GatewayModule(
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
    gateway: GatewayModule,
    request: Request,
    server?: Bun.Server<GatewayControlPeer>,
): Promise<Response | undefined> {
    return (
        gateway as unknown as {
            handleRequest(request: Request, server?: Bun.Server<GatewayControlPeer>): Promise<Response | undefined>;
        }
    ).handleRequest(request, server);
}

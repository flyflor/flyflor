import { describe, expect, test } from "bun:test";
import { GatewayControlHub } from "../src/agent/gateway/control.ts";
import {
    createGatewayControlEnvelope,
    type GatewayControlEnvelope,
    type GatewayControlPeer,
    type GatewayControlSocket,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    type GatewayMessage,
    type GatewayReply,
} from "../src/protocol/contracts/index.ts";
import { GlobalEventBus, RuntimeEventType } from "../src/protocol/events/index.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import type { StreamingDispatchOptions } from "../src/agent/gateway/channels/types.ts";
import type { GatewayStatusSnapshot } from "../src/agent/gateway/channels/status.ts";

class FakeSocket {
    public readonly sent: GatewayControlEnvelope[] = [];
    public closeCount = 0;

    public constructor(public readonly data: GatewayControlPeer) {}

    public send(raw: string): void {
        this.sent.push(JSON.parse(raw) as GatewayControlEnvelope);
    }

    public close(): void {
        this.closeCount += 1;
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

describe("GatewayControlHub", () => {
    test("announces server capabilities on open", () => {
        const hub = createHub();
        const socket = fakeSocket();

        hub.open(socket);

        expect(sent(socket)[0]).toMatchObject({
            type: GatewayControlMessageType.ServerHello,
            payload: {
                clientId: "client-1",
                capabilities: {
                    eventStream: true,
                    protocol: "flyflor.ws.v1",
                },
            },
        });
        hub.dispose();
    });

    test("subscribes to runtime events and publishes matching envelopes", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.EventSubscribe, {
                    types: [RuntimeEventType.ChannelError],
                }),
            ),
        );
        bus.publish({
            type: RuntimeEventType.ChannelError,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "req-1",
            payload: { channel: Channel.Ws, error: "boom" },
        });

        expect(sent(socket).map((envelope) => envelope.type)).toContain(GatewayControlMessageType.EventPublish);
        const published = sent(socket).find((envelope) => envelope.type === GatewayControlMessageType.EventPublish);
        expect(published?.payload?.event).toMatchObject({ type: RuntimeEventType.ChannelError });
        hub.dispose();
    });

    test("dispatches ws messages with explicit runtime context and emits turn deltas/final", async () => {
        const calls: Array<{ message: GatewayMessage; options?: StreamingDispatchOptions }> = [];
        const hub = createHub({
            dispatch: async (message, options) => {
                calls.push({ message, options });
                await options?.onTextDelta?.("hel");
                await options?.onTextDelta?.("lo");
                return { messageId: message.id, route: message.route, text: "hello" };
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.GatewayMessageSend,
                    {
                        context: {
                            activeProject: {
                                id: "project-1",
                                projectDir: "/tmp/project",
                                projectMemoryDir: "/tmp/project/.flyflor/memory",
                                title: "Project",
                            },
                            contextForkId: "fork-1",
                            skillNames: ["skill-a"],
                        },
                        text: "hello",
                        user: { id: "u-1" },
                    },
                    { requestId: "client-req-1" },
                ),
            ),
        );

        expect(calls[0]?.message.route).toMatchObject({
            channel: Channel.Ws,
            chatId: "u-1",
            chatType: ChatType.Direct,
        });
        expect(calls[0]?.options?.context).toMatchObject({
            activeProject: { id: "project-1" },
            contextForkId: "fork-1",
            skillNames: ["skill-a"],
        });
        expect(sent(socket).map((envelope) => envelope.type)).toEqual([
            GatewayControlMessageType.ServerHello,
            GatewayControlMessageType.TurnDelta,
            GatewayControlMessageType.TurnDelta,
            GatewayControlMessageType.TurnFinal,
        ]);
        hub.dispose();
    });

    test("reports runtime failures as turn.error envelopes", async () => {
        const hub = createHub({
            dispatch: async () => {
                throw new Error("runtime failed");
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, {
                    id: "message-1",
                    text: "hello",
                    user: { id: "u-1" },
                }),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.TurnError,
            payload: {
                message: "runtime failed",
                messageId: "message-1",
            },
        });
        hub.dispose();
    });

    test("requires control token for non-local upgrade requests", async () => {
        const hub = createHub({ config: fakeConfig({ control: { token: "secret-token" } }) });
        const server = new FakeUpgradeServer().asBunServer();

        const denied = hub.upgrade(new Request("http://127.0.0.1/ws"), server);
        expect(denied?.status).toBe(401);
        expect(await denied?.json()).toEqual({ error: "gateway_control_unauthorized" });
        expect(server.upgradeCalls).toBe(0);

        const allowed = hub.upgrade(
            new Request("http://127.0.0.1/ws", {
                headers: { authorization: "Bearer secret-token" },
            }),
            server,
        );
        expect(allowed).toBeUndefined();
        expect(server.upgradeCalls).toBe(1);
        hub.dispose();
    });

    test("allows localhost upgrade without token and rejects non-localhost without token", async () => {
        const hub = createHub();
        const server = new FakeUpgradeServer().asBunServer();

        expect(hub.upgrade(new Request("http://localhost/ws"), server)).toBeUndefined();
        expect(server.upgradeCalls).toBe(1);

        const denied = hub.upgrade(new Request("http://example.com/ws"), server);
        expect(denied?.status).toBe(401);
        expect(server.upgradeCalls).toBe(1);
        hub.dispose();
    });
});

function createHub(overrides: Partial<ConstructorParameters<typeof GatewayControlHub>[0]> = {}): GatewayControlHub {
    const events = overrides.events ?? new GlobalEventBus();
    return new GatewayControlHub({
        config: fakeConfig(),
        dispatch: async (message, options): Promise<GatewayReply> => {
            await options?.onTextDelta?.("delta");
            return { messageId: message.id, route: message.route, text: "final" };
        },
        events,
        status: () => ({
            channels: [],
            connectedCount: 0,
            degradedCount: 0,
            gatewayRunning: true,
            host: "127.0.0.1",
            port: 0,
            startedAt: "2026-05-17T00:00:00.000Z",
            streamingCount: 0,
        }) satisfies GatewayStatusSnapshot,
        ...overrides,
    });
}

function fakeSocket(): GatewayControlSocket {
    return new FakeSocket({
        clientId: "client-1",
        connectedAt: "2026-05-17T00:00:00.000Z",
        subscriptions: [],
    }) as unknown as GatewayControlSocket;
}

function sent(socket: GatewayControlSocket): GatewayControlEnvelope[] {
    return (socket as unknown as FakeSocket).sent;
}

function fakeConfig(patch: Partial<GatewayConfig> = {}): GatewayConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        allowedChannels: [Channel.Ws],
        channelReplyUrls: {},
        channels: {},
        control: {},
        stdio: false,
        ...patch,
    } as unknown as GatewayConfig;
}

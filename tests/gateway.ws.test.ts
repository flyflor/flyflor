import { describe, expect, test } from "bun:test";
import { GatewayControlHub } from "../src/agent/gateway/control.ts";
import { buildBuiltinExternalKitCatalog, loadExternalKitCatalog } from "../src/agent/gateway/kit/index.ts";
import {
    createGatewayControlEnvelope,
    type GatewayControlEnvelope,
    type GatewayControlPeer,
    type GatewayControlSocket,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    CttlPermission,
    GatewayControlMessageType,
    type GatewayMessage,
    type GatewayReply,
} from "../src/protocol/contracts/index.ts";
import { GlobalEventBus, RuntimeEventType } from "../src/events/index.ts";
import type { FlyflorPaths, GatewayConfig } from "../src/config/index.ts";
import type { StreamingDispatchOptions } from "../src/agent/gateway/channels/types.ts";
import type { GatewayStatusSnapshot } from "../src/agent/gateway/channels/status.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
                kits: {
                    schemaVersion: 1,
                    kits: [
                        { id: "builtin.cli" },
                        { id: "builtin.tui" },
                        { id: "builtin.gateway" },
                        { id: "builtin.capabilities" },
                    ],
                },
            },
        });
        hub.dispose();
    });

    test("exposes a stable built-in external kit catalog snapshot", () => {
        const catalog = buildBuiltinExternalKitCatalog("2026-05-18T00:00:00.000Z");

        expect(catalog).toMatchObject({
            builtAt: "2026-05-18T00:00:00.000Z",
            schemaVersion: 1,
        });
        expect(catalog.kits.map((kit) => kit.id)).toEqual([
            "builtin.cli",
            "builtin.tui",
            "builtin.gateway",
            "builtin.capabilities",
        ]);
        expect(catalog.kits[0]).toMatchObject({
            kind: "cli",
            permissions: expect.arrayContaining(["control", "event.subscribe", "gateway.message.send"]),
        });
    });

    test("loads project kits over global kits and falls back to builtin when manifest is absent", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-manifest-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.kitDir!, { recursive: true });
            await mkdir(paths.projectKitDir!, { recursive: true });
            await writeFile(
                join(paths.kitDir!, "kits.jsonc"),
                JSON.stringify({
                    schemaVersion: 1,
                    kits: {
                        "global.cli": {
                            id: "global.cli",
                            kind: "cli",
                            name: "Global CLI",
                            source: "builtin",
                            permissions: ["control"],
                        },
                    },
                }),
            );
            await writeFile(
                join(paths.projectKitDir!, "kits.jsonc"),
                JSON.stringify({
                    schemaVersion: 1,
                    kits: {
                        "project.cli": {
                            id: "project.cli",
                            kind: "cli",
                            name: "Project CLI",
                            source: "project",
                            permissions: ["control", "event.subscribe"],
                        },
                    },
                }),
            );

            const catalog = await loadExternalKitCatalog(paths, "2026-05-18T00:00:00.000Z");
            expect(catalog.kits.map((kit) => kit.id)).toEqual(["global.cli", "project.cli"]);

            const emptyRoot = await mkdtemp(join(tmpdir(), "flyflor-kit-empty-"));
            try {
                const emptyPaths = testPaths(emptyRoot);
                const builtin = await loadExternalKitCatalog(emptyPaths, "2026-05-18T00:00:00.000Z");
                expect(builtin.kits.map((kit) => kit.id)).toEqual([
                    "builtin.cli",
                    "builtin.tui",
                    "builtin.gateway",
                    "builtin.capabilities",
                ]);
            } finally {
                await rm(emptyRoot, { recursive: true, force: true });
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("rejects incompatible external kit manifest schema versions", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-version-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectKitDir!, { recursive: true });
            await writeFile(
                join(paths.projectKitDir!, "kits.jsonc"),
                JSON.stringify({
                    schemaVersion: 2,
                    kits: {},
                }),
            );

            await expect(loadExternalKitCatalog(paths)).rejects.toThrow("schemaVersion must be 1.");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("reports invalid kit manifest as a control error during server hello", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-invalid-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectKitDir!, { recursive: true });
            await writeFile(
                join(paths.projectKitDir!, "kits.jsonc"),
                JSON.stringify({
                    kits: {
                        broken: {
                            kind: "cli",
                            permissions: ["not-a-permission"],
                        },
                    },
                }),
            );
            const hub = createHub({ paths });
            const socket = fakeSocket();

            hub.open(socket);
            await waitForEnvelope(socket);

            expect(sent(socket)[0]).toMatchObject({
                type: GatewayControlMessageType.Error,
                payload: {
                    message: "kits.broken.permissions.0 must be a valid enum value.",
                },
            });
            hub.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
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

    test("keeps the latest CTTL capability catalog available through control snapshot", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.CapabilityCatalogGet)),
        );
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.CapabilityCatalogSnapshot,
            payload: { catalog: null },
        });

        bus.publish({
            type: RuntimeEventType.CttlCapabilityCatalogBuilt,
            at: "2026-05-18T12:00:00.000Z",
            requestId: "req-cttl",
            payload: {
                builtAt: "2026-05-18T12:00:00.000Z",
                capabilities: [{ name: "workspace.read", permission: CttlPermission.Read }],
                failedSources: [],
                hiddenCapabilities: [],
                staleSources: [],
                totals: { capabilities: 1, hidden: 0, prompts: 0, resources: 0, tools: 1, userTools: 0 },
            },
        });
        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.CapabilityCatalogGet)),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.CapabilityCatalogSnapshot,
            payload: {
                catalog: {
                    capabilities: [{ name: "workspace.read", permission: CttlPermission.Read }],
                    totals: { capabilities: 1 },
                },
            },
        });
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

async function waitForEnvelope(socket: GatewayControlSocket): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        if (sent(socket).length > 0) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
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

function testPaths(root: string): FlyflorPaths {
    return {
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        home: join(root, "home"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        mcpDir: join(root, "mcp"),
        pluginDir: join(root, "plugins"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectKitDir: join(root, "project", ".flyflor", "kits"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        storageDir: join(root, "storage"),
        templateDir: join(root, "templates"),
        workspaceDir: join(root, "workspace"),
        kitDir: join(root, "kits"),
    } as FlyflorPaths;
}

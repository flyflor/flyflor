import { describe, expect, test } from "bun:test";
import { SocketControlHub } from "../src/socket/control.ts";
import {
    buildBuiltinExternalKitCatalog,
    externalKitCatalogPath,
    loadExternalKitCatalog,
    loadExternalKitCatalogSnapshot,
} from "../src/socket/kit/index.ts";
import {
    buildGatewayControlSurfaceCapabilities,
    createGatewayControlEnvelope,
    GatewayControlErrorCode,
    type GatewayControlEnvelope,
    type GatewayControlPeer,
    type GatewayControlSocket,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    CapabilityExecutionKind,
    ReplayRecordKind,
    TaskPlanStatus,
    ToolPermission,
    GatewayControlMessageType,
    type GatewayMessage,
    type GatewayReply,
} from "../src/protocol/contracts/index.ts";
import { GlobalEventBus, RuntimeEventType } from "../src/events/index.ts";
import type { FlyflorPaths, GatewayConfig } from "../src/config/index.ts";
import type { GatewayControlDispatchOptions } from "../src/socket/control.ts";
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

    public constructor(private readonly accepted = true) {}

    public upgrade(_request: Request, _options: { data: GatewayControlPeer }): boolean {
        this.upgradeCalls += 1;
        return this.accepted;
    }

    public asBunServer(): Bun.Server<GatewayControlPeer> & { upgradeCalls: number } {
        return this as unknown as Bun.Server<GatewayControlPeer> & { upgradeCalls: number };
    }
}

describe("SocketControlHub", () => {
    test("announces server capabilities on open", () => {
        const hub = createHub();
        const socket = fakeSocket();

        hub.open(socket);

        expect(sent(socket)[0]).toMatchObject({
            type: GatewayControlMessageType.ServerHello,
            payload: {
                clientId: "client-1",
                capabilities: {
                    ...buildGatewayControlSurfaceCapabilities([
                        GatewayControlMessageType.CapabilityCatalogGet,
                        GatewayControlMessageType.ClientHello,
                        GatewayControlMessageType.EventSubscribe,
                        GatewayControlMessageType.EventUnsubscribe,
                        GatewayControlMessageType.GatewayStatusGet,
                        GatewayControlMessageType.HistoryList,
                        GatewayControlMessageType.GatewayMessageSend,
                        GatewayControlMessageType.Ping,
                    ]),
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
                            permissions: ["control", "event.subscribe"],
                        },
                    },
                }),
            );

            const catalog = await loadExternalKitCatalog(paths, "2026-05-18T00:00:00.000Z");
            expect(catalog.kits.map((kit) => kit.id)).toEqual(["global.cli", "project.cli"]);
            expect(catalog.kits.map((kit) => kit.source)).toEqual(["global", "project"]);

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

    test("builds a read-only external kit capability catalog from existing registries", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-capabilities-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectMcpDir, { recursive: true });
            await mkdir(paths.projectPluginDir, { recursive: true });
            await mkdir(join(paths.projectSkillDir, "writer"), { recursive: true });
            await mkdir(paths.projectFlyflorDir, { recursive: true });
            await writeFile(
                join(paths.projectMcpDir, "mcp.json"),
                JSON.stringify({
                    servers: {
                        filesystem: { command: "bunx", args: ["mcp-server-filesystem"], enabled: true },
                    },
                }),
            );
            await writeFile(
                join(paths.projectPluginDir, "plugins.json"),
                JSON.stringify({
                    plugins: {
                        demo: {
                            entry: "./demo.ts",
                            enabled: true,
                            capabilities: {
                                echo: { description: "Echo payload", permission: ToolPermission.Read },
                            },
                        },
                    },
                }),
            );
            await writeFile(
                join(paths.projectSkillDir, "writer", "SKILL.md"),
                "---\nname: writer\ndescription: Draft prose\n---\nUse when drafting prose.\n",
            );
            await writeFile(
                join(paths.projectFlyflorDir, "tools.jsonc"),
                JSON.stringify({
                    tools: {
                        "user.echo": {
                            description: "User echo",
                            permission: ToolPermission.Read,
                        },
                    },
                }),
            );

            const catalog = await loadExternalKitCatalogSnapshot(paths, "2026-05-18T00:00:00.000Z");

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
            expect(catalog.capabilities).toEqual([
                { enabled: true, name: "filesystem", source: "mcp", sourceId: "project" },
                { description: undefined, enabled: true, name: "demo", source: "plugin", sourceId: "project" },
                { description: "Echo payload", enabled: true, name: "plugin.demo.echo", source: "plugin", sourceId: "demo" },
                { description: "Draft prose", enabled: true, name: "writer", source: "skill", sourceId: "project" },
                { description: "User echo", enabled: true, name: "user.echo", source: "user-tool", sourceId: "project" },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("resolves external kit manifest paths by source without mutating path semantics", () => {
        const paths = testPaths("/tmp/flyflor-kit-paths");

        expect(externalKitCatalogPath(paths, { global: true })).toBe("/tmp/flyflor-kit-paths/kits/kits.jsonc");
        expect(externalKitCatalogPath(paths)).toBe("/tmp/flyflor-kit-paths/project/.flyflor/kits/kits.jsonc");
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

    test("rejects kit commands that omit their required permissions", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-permission-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectKitDir!, { recursive: true });
            await writeFile(
                join(paths.projectKitDir!, "kits.jsonc"),
                JSON.stringify({
                    kits: {
                        sender: {
                            commands: [GatewayControlMessageType.GatewayMessageSend],
                            permissions: ["control"],
                        },
                    },
                }),
            );

            await expect(loadExternalKitCatalog(paths)).rejects.toThrow(
                "kits.sender.permissions must include gateway.message.send for command gateway.message.send.",
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts history.list as a control-scoped command in kit manifests", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-history-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectKitDir!, { recursive: true });
            await writeFile(
                join(paths.projectKitDir!, "kits.jsonc"),
                JSON.stringify({
                    kits: {
                        history: {
                            commands: [GatewayControlMessageType.HistoryList],
                            permissions: ["control"],
                        },
                    },
                }),
            );

            const catalog = await loadExternalKitCatalog(paths);
            expect(catalog.kits).toEqual([
                expect.objectContaining({
                    commands: [GatewayControlMessageType.HistoryList],
                    id: "history",
                    permissions: ["control"],
                }),
            ]);
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
                    code: GatewayControlErrorCode.Internal,
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

    test("acks client.hello with stable client identity echo", async () => {
        const hub = createHub();
        const socket = fakeSocket();
        hub.open(socket);

        const envelope = createGatewayControlEnvelope(
            GatewayControlMessageType.ClientHello,
            {
                capabilities: { ui: "rust-tui" },
                clientId: "rust-client",
                name: "Rust TUI",
                version: "0.1.0",
            },
            { id: "client-hello-1", requestId: "req-client-1" },
        );
        await hub.message(socket, JSON.stringify(envelope));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "client-hello-1",
            requestId: "req-client-1",
            type: GatewayControlMessageType.Ack,
            payload: {
                clientId: "client-1",
                received: GatewayControlMessageType.ClientHello,
            },
        });
        hub.dispose();
    });

    test("keeps server.hello as the initial connection snapshot and does not let client.hello rewrite it", async () => {
        const hub = createHub();
        const socket = fakeSocket();
        hub.open(socket);

        const hello = sent(socket)[0];
        expect(hello).toMatchObject({
            type: GatewayControlMessageType.ServerHello,
            payload: {
                clientId: "client-1",
                connectedAt: "2026-05-17T00:00:00.000Z",
                status: {
                    clientCount: 1,
                    gatewayRunning: true,
                    host: "127.0.0.1",
                    port: 0,
                },
            },
        });

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ClientHello,
                    {
                        clientId: "rust-client-overwrite-attempt",
                        name: "Rust TUI",
                        version: "0.1.0",
                    },
                    { id: "client-hello-bootstrap-1", requestId: "req-bootstrap-1" },
                ),
            ),
        );

        expect(sent(socket)[0]).toEqual(hello);
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.Ack,
            payload: {
                clientId: "client-1",
                received: GatewayControlMessageType.ClientHello,
            },
        });
        hub.dispose();
    });

    test("returns a stable gateway status snapshot for Rust clients", async () => {
        const hub = createHub();
        const socket = fakeSocket();
        hub.open(socket);

        const envelope = createGatewayControlEnvelope(
            GatewayControlMessageType.GatewayStatusGet,
            undefined,
            { id: "status-get-1", requestId: "req-status-1" },
        );
        await hub.message(socket, JSON.stringify(envelope));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "status-get-1",
            requestId: "req-status-1",
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: {
                status: {
                    channels: [],
                    clientCount: 1,
                    connectedCount: 0,
                    degradedCount: 0,
                    gatewayRunning: true,
                    host: "127.0.0.1",
                    port: 0,
                    startedAt: "2026-05-17T00:00:00.000Z",
                    streamingCount: 0,
                },
            },
        });
        hub.dispose();
    });

    test("tracks live ws peer count separately from channel availability", async () => {
        const hub = createHub({
            status: () => ({
                channels: [],
                clientCount: 0,
                connectedCount: 1,
                degradedCount: 0,
                gatewayRunning: true,
                host: "127.0.0.1",
                port: 0,
                startedAt: "2026-05-17T00:00:00.000Z",
                streamingCount: 1,
            }),
        });
        const first = fakeSocket("client-1");
        const second = fakeSocket("client-2");
        hub.open(first);
        hub.open(second);

        await hub.message(
            first,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)),
        );
        expect(sent(first).at(-1)).toMatchObject({
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: {
                status: {
                    clientCount: 2,
                    connectedCount: 1,
                    streamingCount: 1,
                },
            },
        });

        hub.close(second);
        await hub.message(
            first,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)),
        );
        expect(sent(first).at(-1)).toMatchObject({
            payload: {
                status: {
                    clientCount: 1,
                    connectedCount: 1,
                },
            },
        });
        hub.dispose();
    });

    test("returns persisted history snapshots through history.list without routing through turn logic", async () => {
        const hub = createHub({
            listChatHistory: (input) => {
                expect(input).toEqual({ beforeTs: 200, limit: 2 });
                return [
                    {
                        assistantText: "Assistant 1",
                        contextForks: [{
                            id: "fork-1",
                            ownerKey: "scope:history",
                            title: "Replay fork",
                            summary: "Replay fork summary",
                            continuitySummary: "Keep the replay context small",
                            maxContextTokens: 12000,
                            inheritedEventIds: ["event-1"],
                            createdAt: "2026-05-17T00:00:00.000Z",
                            updatedAt: "2026-05-17T00:00:00.000Z",
                        }],
                        executiveToolExecutions: [{
                            capabilityKind: CapabilityExecutionKind.McpTool,
                            key: "workspace.read",
                            ok: true,
                            resultSummary: "kind=text chars=25 preview=approved capability smoke",
                        }],
                        eventId: "event-1",
                        replays: [{
                            id: "replay-1",
                            ownerKey: "scope:history",
                            kind: ReplayRecordKind.Blackboard,
                            title: "Replay",
                            summary: "Replay summary",
                            visibleFacts: [],
                            openQuestions: [],
                            taskPlanId: "plan-1",
                            contextForkId: "fork-1",
                            blackboardTurnId: "bb-1",
                            createdAt: "2026-05-17T00:00:00.000Z",
                            updatedAt: "2026-05-17T00:00:00.000Z",
                        }],
                        taskPlans: [{
                            id: "plan-1",
                            ownerKey: "scope:history",
                            title: "Plan",
                            summary: "Plan summary",
                            status: TaskPlanStatus.InProgress,
                            progress: 0.5,
                            stepCount: 1,
                            completedStepCount: 0,
                            step: [{
                                id: "step-1",
                                title: "Step",
                                status: TaskPlanStatus.InProgress,
                                order: 0,
                                progress: 0.5,
                            }],
                            createdAt: "2026-05-17T00:00:00.000Z",
                            updatedAt: "2026-05-17T00:00:00.000Z",
                        }],
                        ts: 100,
                        userText: "User 1",
                    },
                    {
                        assistantText: "Assistant 2",
                        eventId: "event-2",
                        ts: 200,
                        userText: "User 2",
                    },
                ];
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.HistoryList,
                    { beforeTs: 200, limit: 2 },
                    { id: "history-list-1", requestId: "req-history-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "history-list-1",
            requestId: "req-history-1",
            type: GatewayControlMessageType.HistorySnapshot,
            payload: {
                history: [
                    {
                        assistantText: "Assistant 1",
                        eventId: "event-1",
                        metadata: {
                            executiveToolExecutions: [{
                                capabilityKind: CapabilityExecutionKind.McpTool,
                                key: "workspace.read",
                                ok: true,
                                resultSummary: "kind=text chars=25 preview=approved capability smoke",
                            }],
                            kind: "reply",
                            messageId: "event-1",
                            planning: {
                                contextForks: [{
                                    id: "fork-1",
                                    continuitySummary: "Keep the replay context small",
                                    maxContextTokens: 12000,
                                    title: "Replay fork",
                                }],
                                replays: [{
                                    blackboardTurnId: "bb-1",
                                    contextForkId: "fork-1",
                                    id: "replay-1",
                                    kind: ReplayRecordKind.Blackboard,
                                    summary: "Replay summary",
                                    taskPlanId: "plan-1",
                                    title: "Replay",
                                }],
                                taskPlans: [{
                                    completedStepCount: 0,
                                    id: "plan-1",
                                    progress: 0.5,
                                    status: TaskPlanStatus.InProgress,
                                    stepCount: 1,
                                    steps: [{
                                        id: "step-1",
                                        order: 0,
                                        progress: 0.5,
                                        status: TaskPlanStatus.InProgress,
                                        title: "Step",
                                    }],
                                    summary: "Plan summary",
                                    title: "Plan",
                                }],
                            },
                        },
                        ts: 100,
                        userText: "User 1",
                    },
                    { assistantText: "Assistant 2", eventId: "event-2", ts: 200, userText: "User 2" },
                ],
                nextBeforeTs: 99,
            },
        });
        hub.dispose();
    });

    test("keeps empty history.list replay as a ledger boundary with no next cursor", async () => {
        let dispatchCount = 0;
        const hub = createHub({
            dispatch: async (message) => {
                dispatchCount += 1;
                return { messageId: message.id, route: message.route, text: "unexpected" };
            },
            listChatHistory: (input) => {
                expect(input).toEqual({ beforeTs: undefined, limit: 1 });
                return [];
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.HistoryList,
                    { limit: 1 },
                    { id: "history-empty-1", requestId: "req-history-empty-1" },
                ),
            ),
        );

        expect(dispatchCount).toBe(0);
        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "history-empty-1",
            requestId: "req-history-empty-1",
            type: GatewayControlMessageType.HistorySnapshot,
            payload: {
                history: [],
            },
        });
        expect(sent(socket).at(-1)?.payload).not.toHaveProperty("nextBeforeTs");
        hub.dispose();
    });

    test("responds to ping with pong without affecting the connection snapshot surface", async () => {
        const hub = createHub();
        const socket = fakeSocket();
        hub.open(socket);
        const initialServerHello = sent(socket)[0];

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.Ping,
                    { probe: "keepalive" },
                    { id: "ping-1", requestId: "req-ping-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "ping-1",
            requestId: "req-ping-1",
            type: GatewayControlMessageType.Pong,
            payload: {
                now: expect.any(String),
            },
        });
        expect(sent(socket)[0]).toEqual(initialServerHello);
        hub.dispose();
    });

    test("acks subscribe and unsubscribe and stops event delivery after unsubscribe", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        const subscribe = createGatewayControlEnvelope(
            GatewayControlMessageType.EventSubscribe,
            {
                requestId: "runtime-req-1",
                types: [RuntimeEventType.ChannelError],
            },
            { id: "event-sub-1", requestId: "req-sub-1" },
        );
        await hub.message(socket, JSON.stringify(subscribe));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "event-sub-1",
            requestId: "req-sub-1",
            type: GatewayControlMessageType.Ack,
            payload: {
                subscriptions: [{ requestId: "runtime-req-1", types: [RuntimeEventType.ChannelError] }],
            },
        });

        bus.publish({
            type: RuntimeEventType.ChannelError,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "runtime-req-1",
            payload: { channel: Channel.Ws, error: "boom" },
        });
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toHaveLength(1);

        const unsubscribe = createGatewayControlEnvelope(
            GatewayControlMessageType.EventUnsubscribe,
            {
                requestId: "runtime-req-1",
                types: [RuntimeEventType.ChannelError],
            },
            { id: "event-unsub-1", requestId: "req-unsub-1" },
        );
        await hub.message(socket, JSON.stringify(unsubscribe));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "event-unsub-1",
            requestId: "req-unsub-1",
            type: GatewayControlMessageType.Ack,
            payload: {
                subscriptions: [],
            },
        });

        bus.publish({
            type: RuntimeEventType.ChannelError,
            at: "2026-05-17T00:01:00.000Z",
            requestId: "runtime-req-1",
            payload: { channel: Channel.Ws, error: "boom-again" },
        });
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toHaveLength(1);
        hub.dispose();
    });

    test("delivers event.publish when subscribing by runtime event class without a requestId", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.EventSubscribe,
                    {
                        classes: ["lifecycle"],
                    },
                    { id: "event-sub-class-1", requestId: "req-sub-class-1" },
                ),
            ),
        );

        bus.publish({
            type: RuntimeEventType.AgentTurnStart,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "runtime-req-class-1",
            payload: { channel: Channel.Ws },
        });

        expect(sent(socket).find((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toMatchObject({
            type: GatewayControlMessageType.EventPublish,
            payload: {
                event: expect.objectContaining({
                    type: RuntimeEventType.AgentTurnStart,
                    requestId: "runtime-req-class-1",
                }),
            },
        });
        hub.dispose();
    });

    test("keeps the latest Executive capability catalog available through control snapshot", async () => {
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
            type: RuntimeEventType.ExecutiveCapabilityCatalogBuilt,
            at: "2026-05-18T12:00:00.000Z",
            requestId: "req-executive",
            payload: {
                builtAt: "2026-05-18T12:00:00.000Z",
                capabilities: [{ name: "workspace.read", permission: ToolPermission.Read }],
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
                    capabilities: [{ name: "workspace.read", permission: ToolPermission.Read }],
                    totals: { capabilities: 1 },
                },
            },
        });
        hub.dispose();
    });

    test("dispatches ws messages with explicit runtime context and emits turn deltas/final", async () => {
        const calls: Array<{
            message: GatewayMessage;
            options?: GatewayControlDispatchOptions;
        }> = [];
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
                            activeScope: {
                                id: "scope-1",
                                projectDir: "/tmp/scope",
                                projectMemoryDir: "/tmp/scope/.flyflor/memory",
                                title: "Scope",
                            },
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
                    { id: "send-live-1", requestId: "client-req-1" },
                ),
            ),
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]?.message).toMatchObject({
            text: "hello",
            user: { id: "u-1" },
        });
        expect(calls[0]?.message.route).toMatchObject({
            channel: Channel.Ws,
            conversationKey: "ws-conversation",
            chatType: ChatType.Direct,
        });
        expect(calls[0]?.options?.context).toMatchObject({
            activeScope: { id: "scope-1" },
            contextForkId: "fork-1",
            requestId: "client-req-1",
            skillNames: ["skill-a"],
        });
        expect(sent(socket)[1]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnDelta,
            payload: {
                delta: "hel",
                messageId: calls[0]?.message.id,
            },
        });
        expect(sent(socket)[2]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnDelta,
            payload: {
                delta: "lo",
                messageId: calls[0]?.message.id,
            },
        });
        expect(sent(socket)[3]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnFinal,
            payload: {
                reply: {
                    messageId: calls[0]?.message.id,
                    text: "hello",
                },
            },
        });
        expect(sent(socket).map((envelope) => envelope.type)).toEqual([
            GatewayControlMessageType.ServerHello,
            GatewayControlMessageType.TurnDelta,
            GatewayControlMessageType.TurnDelta,
            GatewayControlMessageType.TurnFinal,
        ]);
        hub.dispose();
    });

    test("reuses envelope requestId as the runtime request correlation key", async () => {
        const calls: Array<GatewayControlDispatchOptions | undefined> = [];
        const hub = createHub({
            dispatch: async (_message, options) => {
                calls.push(options);
                return {
                    messageId: "reply-1",
                    route: { channel: Channel.Ws, conversationKey: "ws-conversation", chatType: ChatType.Direct },
                    text: "done",
                };
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
                        id: "message-request-id-1",
                        text: "reuse request id",
                        user: { id: "u-1" },
                    },
                    { id: "send-1", requestId: "req-from-client-1" },
                ),
            ),
        );

        expect(calls[0]?.context?.requestId).toBe("req-from-client-1");
        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "send-1",
            requestId: "req-from-client-1",
            type: GatewayControlMessageType.TurnFinal,
        });
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

    test("emits structured invalid-envelope and invalid-payload control errors", async () => {
        const hub = createHub();
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(socket, JSON.stringify({
            protocol: "invalid",
            id: "env-1",
            type: GatewayControlMessageType.Ping,
            at: "2026-05-20T00:00:00.000Z",
        }));
        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, {})),
        );

        expect(sent(socket).slice(-2)).toEqual([
            expect.objectContaining({
                type: GatewayControlMessageType.Error,
                payload: expect.objectContaining({
                    code: GatewayControlErrorCode.InvalidEnvelope,
                    details: { protocol: "invalid" },
                    message: "Unsupported gateway control protocol",
                }),
            }),
            expect.objectContaining({
                type: GatewayControlMessageType.Error,
                payload: expect.objectContaining({
                    code: GatewayControlErrorCode.InvalidPayload,
                    message: "gateway.message.send payload requires text",
                }),
            }),
        ]);
        hub.dispose();
    });

    test("carries ask and todo snapshots through turn.final reply metadata", async () => {
        const hub = createHub({
            dispatch: async (message) => ({
                messageId: message.id,
                route: message.route,
                text: "Need confirmation?",
                metadata: {
                    kind: "ask",
                        ask: {
                            choiceCount: 1,
                            choices: [{ label: "Continue", description: "Proceed with the current plan" }],
                            executiveToolLoop: {
                                askId: "ask-1",
                                message: "Need one more step",
                                resume: { mode: "continue" },
                                stepCount: 2,
                                stop: "ask",
                                toolBudgetExhausted: true,
                            },
                            freeform: true,
                            prompt: "Need confirmation?",
                            questionCount: 0,
                        questions: [],
                        reason: "other",
                        snapshotId: "snapshot-1",
                    },
                    planning: {
                        contextForks: [],
                        replays: [],
                        taskPlans: [{
                            completedStepCount: 0,
                            id: "plan-1",
                            progress: 0,
                            status: "planned",
                            stepCount: 1,
                            steps: [{ id: "step-1", order: 0, status: "planned", title: "Confirm direction" }],
                            summary: "Need one confirmation step",
                            title: "Confirmation",
                        }],
                    },
                },
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, {
                    id: "message-ask-1",
                    text: "hello",
                    user: { id: "u-1" },
                }),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.TurnFinal,
            payload: {
                reply: {
                    metadata: {
                        kind: "ask",
                        ask: {
                            executiveToolLoop: {
                                askId: "ask-1",
                                message: "Need one more step",
                                resume: { mode: "continue" },
                                stepCount: 2,
                                stop: "ask",
                                toolBudgetExhausted: true,
                            },
                            prompt: "Need confirmation?",
                            reason: "other",
                            snapshotId: "snapshot-1",
                        },
                        planning: {
                            taskPlans: [{
                                id: "plan-1",
                                title: "Confirmation",
                                steps: [{ id: "step-1", title: "Confirm direction" }],
                            }],
                        },
                    },
                },
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

    test("returns structured json when ws upgrade fails after authorization", async () => {
        const hub = createHub();
        const server = new FakeUpgradeServer(false).asBunServer();

        const failed = hub.upgrade(new Request("http://localhost/ws"), server);

        expect(failed?.status).toBe(400);
        await expect(failed?.json()).resolves.toEqual({ error: "gateway_control_upgrade_failed" });
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

function createHub(overrides: Partial<ConstructorParameters<typeof SocketControlHub>[0]> = {}): SocketControlHub {
    const events = overrides.events ?? new GlobalEventBus();
    return new SocketControlHub({
        config: fakeConfig(),
        dispatch: async (message, options): Promise<GatewayReply> => {
            await options?.onTextDelta?.("delta");
            return { messageId: message.id, route: message.route, text: "final" };
        },
        events,
        listChatHistory: () => [],
        status: () => ({
            channels: [],
            clientCount: 0,
            connectedCount: 0,
            degradedCount: 0,
            gatewayRunning: true,
            host: "127.0.0.1",
            port: 0,
            startedAt: "2026-05-17T00:00:00.000Z",
            streamingCount: 0,
        }),
        ...overrides,
    });
}

function fakeSocket(clientId = "client-1"): GatewayControlSocket {
    return new FakeSocket({
        clientId,
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

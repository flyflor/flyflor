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
    TaskPlanDecisionAction,
    TaskPlanStatus,
    ToolPermission,
    GatewayControlMessageType,
    ToolLifecycleEventType,
    MemoryEventType,
    ModelRole,
    RuntimeEventClass,
    SandboxMode,
    type ContextForkRecord,
    type GatewayMessage,
    type GatewayReply,
    type TaskPlanRecord,
} from "../src/protocol/contracts/index.ts";
import { GlobalEventBus, RuntimeEventType } from "../src/events/index.ts";
import type { FlyflorPaths, GatewayConfig } from "../src/config/index.ts";
import type { GatewayControlDispatchOptions } from "../src/socket/control.ts";
import { SocketQueryComponent, type SocketQueryComponentPort } from "../src/socket/query/index.ts";
import { BlackboardModule, SQLiteBlackboardStore } from "../src/agent/blackboard/index.ts";
import { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
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
                        GatewayControlMessageType.ForkCreate,
                        GatewayControlMessageType.GatewayStatusGet,
                        GatewayControlMessageType.HistoryDetailGet,
                        GatewayControlMessageType.ScopeList,
                        GatewayControlMessageType.ScopeDetailGet,
                        GatewayControlMessageType.ForkList,
                        GatewayControlMessageType.ForkMemoryGet,
                        GatewayControlMessageType.ForkDetailGet,
                        GatewayControlMessageType.AskList,
                        GatewayControlMessageType.AskDetailGet,
                        GatewayControlMessageType.BlackboardList,
                        GatewayControlMessageType.BlackboardDetailGet,
                        GatewayControlMessageType.TaskList,
                        GatewayControlMessageType.TaskDetailGet,
                        GatewayControlMessageType.ReplayList,
                        GatewayControlMessageType.ReplayDetailGet,
                        GatewayControlMessageType.ThoughtDetailGet,
                        GatewayControlMessageType.CrystalList,
                        GatewayControlMessageType.ExecutionJobList,
                        GatewayControlMessageType.ExecutionJobDetailGet,
                        GatewayControlMessageType.HistoryList,
                        GatewayControlMessageType.TaskPlanDecide,
                        GatewayControlMessageType.GatewayMessageSend,
                        GatewayControlMessageType.GatewayMessageInterrupt,
                        GatewayControlMessageType.GatewayMessageUndo,
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
                { description: "external sidecar is not configured", enabled: false, name: "archive.create", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "archive.extract", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "audio.speak", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "audio.transcribe", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.click", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.evaluate", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.navigate", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.open", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.screenshot", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.snapshot", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.type", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "browser.use", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "computer.keyboard", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "computer.mouse", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "computer.use", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "computer.window", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "data.convert", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "file.hash", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "lsp.diagnostics", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "lsp.symbols", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "screen.screenshot", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "task.background", source: "user-tool", sourceId: "external:missing" },
                { description: "User echo", enabled: true, name: "user.echo", source: "user-tool", sourceId: "project" },
                { description: "external sidecar is not configured", enabled: false, name: "vision.analyze", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "vision.ocr", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "web.download", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "web.extract", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "web.fetch", source: "user-tool", sourceId: "external:missing" },
                { description: "external sidecar is not configured", enabled: false, name: "web.search", source: "user-tool", sourceId: "external:missing" },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("exposes the full external tool surface through the socket kit catalog", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-kit-xtools-full-"));
        const paths = testPaths(root);
        try {
            const catalog = await loadExternalKitCatalogSnapshot(paths, "2026-05-24T00:00:00.000Z");
            const externalNames = catalog.capabilities
                .filter((entry) => entry.source === "user-tool" && entry.sourceId === "external:missing")
                .map((entry) => entry.name);

            expect(externalNames).toEqual([
                "archive.create",
                "archive.extract",
                "audio.speak",
                "audio.transcribe",
                "browser.click",
                "browser.evaluate",
                "browser.navigate",
                "browser.open",
                "browser.screenshot",
                "browser.snapshot",
                "browser.type",
                "browser.use",
                "computer.keyboard",
                "computer.mouse",
                "computer.use",
                "computer.window",
                "data.convert",
                "file.hash",
                "lsp.diagnostics",
                "lsp.symbols",
                "screen.screenshot",
                "task.background",
                "vision.analyze",
                "vision.ocr",
                "web.download",
                "web.extract",
                "web.fetch",
                "web.search",
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

    test("subscribes to all stable tool lifecycle event types", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.EventSubscribe, {
                    types: Object.values(ToolLifecycleEventType),
                }),
            ),
        );

        for (const type of Object.values(ToolLifecycleEventType)) {
            bus.publish({
                type,
                at: "2026-05-24T00:00:00.000Z",
                requestId: "req-tool-life-1",
                payload: {
                    capabilityKind: CapabilityExecutionKind.McpTool,
                    key: "workspace.read",
                },
            });
        }

        const publishedTypes = sent(socket)
            .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
            .map((envelope) => envelope.payload?.event)
            .filter((event): event is { type: string } => typeof event === "object" && event !== null && "type" in event)
            .map((event) => event.type);
        expect(publishedTypes).toEqual(Object.values(ToolLifecycleEventType));
        hub.dispose();
    });

    test("subscribes to all stable runtime event types while rejecting unknown types", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.EventSubscribe,
                    { types: Object.values(RuntimeEventType) },
                    { id: "runtime-event-subscribe-all-1", requestId: "req-runtime-event-subscribe-all-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "runtime-event-subscribe-all-1",
            requestId: "req-runtime-event-subscribe-all-1",
            type: GatewayControlMessageType.Ack,
            payload: {
                subscriptions: [{ types: Object.values(RuntimeEventType) }],
            },
        });

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.EventSubscribe,
                    { types: ["runtime.unknown"] },
                    { id: "runtime-event-subscribe-unknown-1", requestId: "req-runtime-event-subscribe-unknown-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "runtime-event-subscribe-unknown-1",
            requestId: "req-runtime-event-subscribe-unknown-1",
            type: GatewayControlMessageType.Error,
            payload: {
                code: GatewayControlErrorCode.InvalidPayload,
                details: { type: "runtime.unknown" },
                message: "event subscription types must use known runtime event types",
            },
        });
        hub.dispose();
    });

    test("delivers TUI topic refresh events for recall, ask, fork, blackboard, and todo panels", async () => {
        const bus = new GlobalEventBus();
        const topicTypes = [
            RuntimeEventType.MemoryRecallStarted,
            RuntimeEventType.MemoryRecallItem,
            RuntimeEventType.MemoryRecallAssembled,
            RuntimeEventType.MemoryRecallCompleted,
            RuntimeEventType.ScopeRecallLoaded,
            RuntimeEventType.ScopeRecallDecided,
            RuntimeEventType.ThoughtStarted,
            RuntimeEventType.ThoughtDelta,
            RuntimeEventType.ThoughtCompleted,
            RuntimeEventType.MemoryContextForkWritten,
            RuntimeEventType.MemoryAskRecorded,
            RuntimeEventType.MemoryAskAnswered,
            RuntimeEventType.ConfirmAnswered,
            RuntimeEventType.BlackboardMessageAppended,
            RuntimeEventType.BlackboardTurnEnd,
            RuntimeEventType.MemoryTaskPlanWritten,
        ];
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.EventSubscribe,
                    { types: topicTypes },
                    { id: "topic-subscribe-1", requestId: "req-topic-subscribe-1" },
                ),
            ),
        );

        for (const type of topicTypes) {
            bus.publish({
                type,
                at: "2026-05-24T00:00:00.000Z",
                requestId: "req-topic-refresh-1",
                payload: {
                    askEventId: "ask-1",
                    blackboardTurnId: "bb-1",
                    confidence: 0.92,
                    detail: {
                        markdown: "### 回忆中\n\n- candidate scope",
                    },
                    decision: "load",
                    forkId: "fork-1",
                    item: { scope: { id: "scope-1", title: "Core scope" }, vector: { score: 0.91 } },
                    markdown: "### 回忆中\n\n- candidate scope",
                    ownerKey: "scope:core",
                    planId: "plan-1",
                    progress: 0.5,
                    route: { mode: "direct-with-watch", reason: "observe" },
                    scopeId: "scope-1",
                    snapshotId: "snapshot-1",
                    status: "in-progress",
                    summary: "Context row summary",
                    title: "Core scope",
                },
            });
        }

        const published = sent(socket)
            .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
            .map((envelope) => envelope.payload?.event)
            .filter((event): event is { type: string; payload?: Record<string, unknown> } =>
                typeof event === "object" && event !== null && "type" in event,
            );
        expect(published.map((event) => event.type)).toEqual(topicTypes);
        expect(published.find((event) => event.type === RuntimeEventType.ScopeRecallLoaded)?.payload).toMatchObject({
            scopeId: "scope-1",
            title: "Core scope",
            confidence: 0.92,
        });
        expect(published.find((event) => event.type === RuntimeEventType.MemoryRecallAssembled)?.payload).toMatchObject({
            markdown: "### 回忆中\n\n- candidate scope",
            scopeId: "scope-1",
        });
        expect(published.find((event) => event.type === RuntimeEventType.ThoughtCompleted)?.payload).toMatchObject({
            route: { mode: "direct-with-watch", reason: "observe" },
            summary: "Context row summary",
        });
        expect(published.find((event) => event.type === RuntimeEventType.MemoryTaskPlanWritten)?.payload).toMatchObject({
            planId: "plan-1",
            ownerKey: "scope:core",
            status: "in-progress",
            progress: 0.5,
        });
        hub.dispose();
    });

    test("delivers blackboard refresh events through write-class subscriptions", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.EventSubscribe,
                    { classes: [RuntimeEventClass.Write] },
                    { id: "blackboard-write-subscribe-1" },
                ),
            ),
        );
        bus.publish({
            type: RuntimeEventType.BlackboardMessageAppended,
            at: "2026-05-24T00:00:00.000Z",
            requestId: "req-blackboard-1",
            payload: { turnId: "bb-1", messageId: "bb-msg-1", role: "worker" },
        });
        bus.publish({
            type: RuntimeEventType.BlackboardTurnEnd,
            at: "2026-05-24T00:00:01.000Z",
            requestId: "req-blackboard-1",
            payload: { turnId: "bb-1", status: "converged" },
        });

        expect(sent(socket)
            .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
            .map((envelope) => eventTypeFromEnvelope(envelope))).toEqual([
                RuntimeEventType.BlackboardMessageAppended,
                RuntimeEventType.BlackboardTurnEnd,
            ]);
        hub.dispose();
    });

    test("publishes structured blackboard stream events without assistant text lanes", async () => {
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
                        types: [
                            RuntimeEventType.BlackboardStarted,
                            RuntimeEventType.BlackboardRoundStarted,
                            RuntimeEventType.BlackboardWorkerDone,
                            RuntimeEventType.BlackboardCompleted,
                        ],
                    },
                    { id: "blackboard-stream-subscribe-1" },
                ),
            ),
        );
        for (const runtimeEvent of [
            {
                type: RuntimeEventType.BlackboardStarted,
                payload: { requestId: "req-blackboard-stream-1", turnId: "bb-1", status: "running", summary: "route" },
            },
            {
                type: RuntimeEventType.BlackboardRoundStarted,
                payload: { requestId: "req-blackboard-stream-1", turnId: "bb-1", round: 1, status: "running" },
            },
            {
                type: RuntimeEventType.BlackboardWorkerDone,
                payload: {
                    requestId: "req-blackboard-stream-1",
                    turnId: "bb-1",
                    round: 1,
                    workerName: "Reviewer",
                    content: "structured worker output",
                    outputSummary: "structured worker output",
                    blockers: [],
                },
            },
            {
                type: RuntimeEventType.BlackboardCompleted,
                payload: {
                    requestId: "req-blackboard-stream-1",
                    turnId: "bb-1",
                    status: "converged",
                    summary: "structured worker output",
                    content: "Round 1\nReviewer: structured worker output",
                },
            },
        ] as const) {
            bus.publish({
                type: runtimeEvent.type,
                at: "2026-05-24T00:00:00.000Z",
                requestId: "req-blackboard-stream-1",
                payload: runtimeEvent.payload,
            });
        }

        const published = sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish);
        expect(published.map((envelope) => eventTypeFromEnvelope(envelope))).toEqual([
            RuntimeEventType.BlackboardStarted,
            RuntimeEventType.BlackboardRoundStarted,
            RuntimeEventType.BlackboardWorkerDone,
            RuntimeEventType.BlackboardCompleted,
        ]);
        expect(published[2]?.payload?.event).toMatchObject({
            payload: {
                content: "structured worker output",
                outputSummary: "structured worker output",
                round: 1,
                workerName: "Reviewer",
            },
        });
        hub.dispose();
    });

    test("blackboard query read model handles an empty new DB without runtime dispatch", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-blackboard-query-empty-"));
        try {
            const queries = new SocketQueryComponent(testPaths(root));
            await queries.initialize();
            expect(await queries.blackboardList({ limit: 5 })).toEqual([]);
            expect(await queries.blackboardDetail({ blackboardTurnId: "missing" })).toBeUndefined();
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("blackboard events emitted by runtime store are published and queryable", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-blackboard-query-live-"));
        try {
            const paths = testPaths(root);
            const bus = new GlobalEventBus();
            const blackboard = new BlackboardModule(new SQLiteBlackboardStore(paths), bus);
            const start = await blackboard.startTurn({
                scopeConstraintId: "scope:blackboard-query",
                requestId: "req-blackboard-query-1",
                goal: "Summarize blackboard state for TUI",
                now: "2026-05-24T00:00:00.000Z",
                workers: [{ role: "summary-worker", name: "Summary worker" }],
            });
            expect(start.acquired).toBe(true);
            if (!start.acquired) throw new Error("expected blackboard start");

            const hub = createHub({ events: bus, queries: new SocketQueryComponent(paths) });
            const socket = fakeSocket();
            hub.open(socket);
            await hub.message(
                socket,
                JSON.stringify(
                    createGatewayControlEnvelope(
                        GatewayControlMessageType.EventSubscribe,
                        { types: [RuntimeEventType.BlackboardMessageAppended, RuntimeEventType.BlackboardTurnEnd] },
                        { id: "blackboard-live-subscribe-1" },
                    ),
                ),
            );

            await blackboard.appendMessage(start.turn.id, {
                role: "worker",
                content: "Blackboard public summary",
                visibility: "public",
                createdAt: "2026-05-24T00:00:01.000Z",
            });
            await blackboard.finishTurn(start.turn.id, "converged", "2026-05-24T00:00:02.000Z");
            await hub.message(
                socket,
                JSON.stringify(
                    createGatewayControlEnvelope(
                        GatewayControlMessageType.BlackboardDetailGet,
                        { blackboardTurnId: start.turn.id },
                        { id: "blackboard-live-detail-1" },
                    ),
                ),
            );
            await hub.message(
                socket,
                JSON.stringify(
                    createGatewayControlEnvelope(
                        GatewayControlMessageType.BlackboardList,
                        { scopeId: "scope:blackboard-query", limit: 5 },
                        { id: "blackboard-live-list-1" },
                    ),
                ),
            );

            expect(sent(socket)
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) => eventTypeFromEnvelope(envelope))).toEqual([
                    RuntimeEventType.BlackboardMessageAppended,
                    RuntimeEventType.BlackboardTurnEnd,
                ]);
            expect(sent(socket)
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) => eventPayloadFromEnvelope(envelope))).toEqual([
                    expect.objectContaining({
                        messageId: expect.any(String),
                        turnId: start.turn.id,
                    }),
                    expect.objectContaining({
                        status: "converged",
                        turnId: start.turn.id,
                    }),
                ]);
            expect(sent(socket).find((envelope) => envelope.correlationId === "blackboard-live-detail-1"))
                .toMatchObject({
                    type: GatewayControlMessageType.BlackboardSnapshot,
                    payload: {
                        data: {
                            turn: {
                                id: start.turn.id,
                                status: "converged",
                                goal: "Summarize blackboard state for TUI",
                                messages: [{ content: "Blackboard public summary", role: "worker" }],
                            },
                        },
                    },
                });
            expect(sent(socket).find((envelope) => envelope.correlationId === "blackboard-live-list-1"))
                .toMatchObject({
                    type: GatewayControlMessageType.BlackboardSnapshot,
                    payload: {
                        data: [{
                            id: start.turn.id,
                            status: "converged",
                            messages: [{ content: "Blackboard public summary" }],
                        }],
                    },
                });
            hub.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("serves fork memory panel data from brain.db without runtime dispatch", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-fork-memory-query-"));
        try {
            const paths = testPaths(root);
            const queries = new SocketQueryComponent(paths);
            await queries.initialize();
            const records: ContextForkRecord[] = Array.from({ length: 6 }, (_value, index) => ({
                id: `fork-${index + 1}`,
                ownerKey: "scope:scope-1",
                scopeId: "scope-1",
                parentId: index > 0 ? `fork-${index}` : undefined,
                title: index === 5 ? "" : `Fork ${index + 1}`,
                summary: `Fork summary ${index + 1}`,
                continuitySummary: `Continuity ${index + 1}`,
                maxContextTokens: 12000,
                inheritedEventIds: [],
                createdAt: `2026-05-24T00:00:0${index}.000Z`,
                updatedAt: `2026-05-24T00:00:0${index}.000Z`,
                sourceEventId: `event-${index + 1}`,
            }));
            for (const record of records) {
                (queries as unknown as { brain: { brain: { writeContextFork(record: ContextForkRecord): ContextForkRecord } } })
                    .brain.brain.writeContextFork(record);
            }
            const directSnapshot = await queries.forkMemory({ scopeId: "scope-1", limit: 5 }, { initialized: true });
            expect(directSnapshot.brainDb.status).toBe("available");
            expect(directSnapshot.brainDb.bytes).toBeGreaterThan(0);
            expect(directSnapshot.brainDb.human).toMatch(/\d+(\.\d)? (B|KB|MB|GB|TB)/);
            expect(directSnapshot.forks.map((fork) => fork.id)).toEqual(["fork-6", "fork-5", "fork-4", "fork-3", "fork-2"]);

            const hub = createHub({ queries });
            const socket = fakeSocket();
            hub.open(socket);

            await hub.message(
                socket,
                JSON.stringify(
                    createGatewayControlEnvelope(
                        GatewayControlMessageType.ForkMemoryGet,
                        { scopeId: "scope-1", limit: 5 },
                        { id: "fork-memory-get-1", requestId: "req-fork-memory-1" },
                    ),
                ),
            );

            const snapshot = sent(socket).find((envelope) => envelope.correlationId === "fork-memory-get-1");
            expect(snapshot).toMatchObject({
                requestId: "req-fork-memory-1",
                type: GatewayControlMessageType.ForkMemorySnapshot,
                payload: {
                    data: {
                        brainDb: {
                            bytes: expect.any(Number),
                            human: expect.any(String),
                            status: "available",
                        },
                    },
                },
            });
            const snapshotPayload = snapshot?.payload as Record<string, unknown> | undefined;
            const data = snapshotPayload?.data as {
                brainDb?: { bytes?: number };
                forks?: Array<{
                    id: string;
                    parentId?: string;
                    sourceEventId?: string;
                    summary?: string;
                    title?: string;
                }>;
            } | undefined;
            expect(data?.forks?.map((fork) => fork.id)).toEqual(["fork-6", "fork-5", "fork-4", "fork-3", "fork-2"]);
            expect(data?.forks?.[0]).toMatchObject({
                id: "fork-6",
                title: "Fork summary 6",
                summary: "Fork summary 6",
                parentId: "fork-5",
                sourceEventId: "event-6",
            });
            hub.dispose();
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("serves execution job snapshots from brain.db without runtime dispatch", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-execution-job-query-"));
        try {
            const paths = testPaths(root);
            await mkdir(paths.configDir, { recursive: true });
            const brain = new BrainStore({ dbPath: join(paths.configDir, "brain.db") });
            await brain.open();
            for (const [index, content] of [
                {
                    kind: "job.created",
                    jobId: "job-1",
                    requestId: "req-job-1",
                    status: "created",
                    stage: "created",
                    progress: { childTotal: 1 },
                    children: [
                        {
                            childId: "inspect",
                            childJobId: "child-job-1",
                            id: "inspect",
                            status: "created",
                            task: { id: "inspect", goal: "Inspect workspace files", toolAllowlist: ["workspace.read"] },
                            toolCalls: 0,
                        },
                    ],
                    ts: 100,
                },
                {
                    kind: "job.child.started",
                    jobId: "job-1",
                    requestId: "req-job-1",
                    childId: "inspect",
                    childJobId: "child-job-1",
                    status: "running",
                    stage: "child-running",
                    task: { id: "inspect", goal: "Inspect workspace files" },
                    ts: 101,
                },
                {
                    kind: "job.tool.executed",
                    jobId: "job-1",
                    requestId: "req-job-1",
                    childId: "inspect",
                    childJobId: "child-job-1",
                    tool: {
                        key: "workspace.read",
                        ok: true,
                        status: "ok",
                        server: "workspace",
                        tool: "read",
                        inputPreview: { path: "README.md" },
                        outputPreview: { text: "short output" },
                        durationMs: 12,
                        limited: true,
                        limitReason: "tool-budget-exhausted",
                    },
                    ts: 102,
                },
                {
                    kind: "job.child.completed",
                    jobId: "job-1",
                    requestId: "req-job-1",
                    childId: "inspect",
                    childJobId: "child-job-1",
                    status: "completed",
                    limited: true,
                    limitReason: "tool-budget-exhausted",
                    toolCalls: 1,
                    ts: 103,
                },
                { kind: "job.completed", jobId: "job-1", requestId: "req-job-1", status: "completed", stage: "completed", progress: { childCompleted: 1, childTotal: 1, toolCalls: 1 }, ts: 104 },
            ].entries()) {
                brain.appendEvent({
                    id: `execution-job-event-${index + 1}`,
                    ownerKey: "scope:scope-job",
                    sourceKey: "req-job-1",
                    ts: content.ts,
                    type: MemoryEventType.ExecutionJob,
                    role: ModelRole.Assistant,
                    content,
                    importance: 0.25,
                });
            }
            brain.close();
            const queries = new SocketQueryComponent(paths);
            const hub = createHub({ queries });
            const socket = fakeSocket();
            hub.open(socket);

            await hub.message(
                socket,
                JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobList, { limit: 5 }, { id: "job-list-1" })),
            );
            await hub.message(
                socket,
                JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobDetailGet, { jobId: "job-1" }, { id: "job-detail-1" })),
            );

            expect(sent(socket).find((envelope) => envelope.correlationId === "job-list-1")).toMatchObject({
                type: GatewayControlMessageType.ExecutionJobSnapshot,
                payload: {
                    data: [
                        expect.objectContaining({
                            jobId: "job-1",
                            requestId: "req-job-1",
                            status: "completed",
                            toolCounts: { "workspace.read": 1 },
                        }),
                    ],
                },
            });
            expect(sent(socket).find((envelope) => envelope.correlationId === "job-detail-1")).toMatchObject({
                type: GatewayControlMessageType.ExecutionJobSnapshot,
                payload: {
                    data: expect.objectContaining({
                        children: [
                            expect.objectContaining({
                                childId: "inspect",
                                childJobId: "child-job-1",
                                id: "inspect",
                                limited: true,
                                limitReason: "tool-budget-exhausted",
                                status: "completed",
                                task: expect.objectContaining({ goal: "Inspect workspace files" }),
                                toolCalls: 1,
                            }),
                        ],
                        jobId: "job-1",
                        toolExecutions: [
                            expect.objectContaining({
                                childJobId: "child-job-1",
                                durationMs: 12,
                                inputPreview: { path: "README.md" },
                                key: "workspace.read",
                                limited: true,
                                limitReason: "tool-budget-exhausted",
                                ok: true,
                                outputPreview: { text: "short output" },
                                server: "workspace",
                                status: "ok",
                                tool: "read",
                            }),
                        ],
                    }),
                },
            });
            hub.dispose();
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("deduplicates fork memory rows with the same structured source and summaries", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-fork-memory-dedupe-"));
        try {
            const paths = testPaths(root);
            const queries = new SocketQueryComponent(paths);
            await queries.initialize();
            const records: ContextForkRecord[] = [
                {
                    id: "fork-old",
                    ownerKey: "scope:scope-1",
                    scopeId: "scope-1",
                    title: "Same fork",
                    summary: "Same user question",
                    continuitySummary: "Same continuation",
                    maxContextTokens: 12000,
                    inheritedEventIds: [],
                    createdAt: "2026-05-24T00:00:00.000Z",
                    updatedAt: "2026-05-24T00:00:00.000Z",
                    sourceEventId: "event-same",
                },
                {
                    id: "fork-new",
                    ownerKey: "scope:scope-1",
                    scopeId: "scope-1",
                    title: "Same fork",
                    summary: "Same user question",
                    continuitySummary: "Same continuation",
                    maxContextTokens: 12000,
                    inheritedEventIds: ["event-same"],
                    createdAt: "2026-05-24T00:00:01.000Z",
                    updatedAt: "2026-05-24T00:00:02.000Z",
                    sourceEventId: "event-same",
                },
                {
                    id: "fork-unique",
                    ownerKey: "scope:scope-1",
                    scopeId: "scope-1",
                    title: "Unique fork",
                    summary: "Different user question",
                    continuitySummary: "Different continuation",
                    maxContextTokens: 12000,
                    inheritedEventIds: [],
                    createdAt: "2026-05-24T00:00:03.000Z",
                    updatedAt: "2026-05-24T00:00:03.000Z",
                    sourceEventId: "event-unique",
                },
            ];
            for (const record of records) {
                (queries as unknown as { brain: { brain: { writeContextFork(record: ContextForkRecord): ContextForkRecord } } })
                    .brain.brain.writeContextFork(record);
            }

            const snapshot = await queries.forkMemory({ scopeId: "scope-1", limit: 5 }, { initialized: true });
            expect(snapshot.forks.map((fork) => fork.id)).toEqual(["fork-unique", "fork-new"]);
            expect(snapshot.forks.find((fork) => fork.id === "fork-old")).toBeUndefined();
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("ask snapshots expose replayable continuation metadata for re-answer", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-ask-reanswer-query-"));
        try {
            const paths = testPaths(root);
            const brain = new BrainStore({ dbPath: join(paths.configDir, "brain.db") });
            await brain.open();
            brain.appendEvent({
                id: "ask-reanswer-1",
                ownerKey: "scope:scope-reanswer",
                sourceKey: "req-reanswer-1",
                sourceSurface: Channel.Ws,
                ts: 100,
                type: MemoryEventType.Ask,
                role: ModelRole.Assistant,
                content: {
                    askId: "ask-reanswer-1",
                    snapshotId: "behavior-reanswer-1",
                    requestId: "req-reanswer-1",
                    chainDepth: 1,
                    ask: {
                        reason: "policy-decision",
                        prompt: "Pick the direction.",
                        freeform: true,
                        choices: [{ label: "Left", value: "left" }],
                    },
                },
            });
            brain.appendEvent({
                id: "continuation-reanswer-1",
                ownerKey: "scope:scope-reanswer",
                sourceKey: "req-reanswer-1",
                sourceSurface: Channel.Ws,
                ts: 101,
                type: MemoryEventType.ContinuationContext,
                role: ModelRole.Assistant,
                parentId: "ask-reanswer-1",
                content: {
                    continuationId: "continuation-reanswer-1",
                    snapshotId: "behavior-reanswer-1",
                    reason: "ask",
                    userFacing: {
                        title: "Pick direction",
                        askPrompt: "Pick the direction.",
                        contextHint: "Need a branch decision",
                    },
                    snapshot: {
                        originalUserMessage: "merge branch",
                    },
                    requestId: "req-reanswer-1",
                },
            });
            brain.close();

            const queries = new SocketQueryComponent(paths);
            await queries.initialize();
            const asks = queries.askList({ scopeId: "scope-reanswer", status: "active", limit: 10 });
            expect(asks).toHaveLength(1);
            expect(asks[0]).toMatchObject({
                continuation: {
                    continuationId: "continuation-reanswer-1",
                    mode: "continue",
                    snapshotId: "behavior-reanswer-1",
                    contextHint: "Need a branch decision",
                },
                replayableAsk: {
                    question: "Pick the direction.",
                    snapshotId: "behavior-reanswer-1",
                    sourceTurnId: "ask-reanswer-1",
                },
            });
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("fork memory panel reports unknown brain.db when the DB file is absent", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-fork-memory-missing-"));
        try {
            const paths = testPaths(root);
            const queries = new SocketQueryComponent(paths);
            const hub = createHub({ queries });
            const socket = fakeSocket();
            hub.open(socket);

            await hub.message(
                socket,
                JSON.stringify(
                    createGatewayControlEnvelope(
                        GatewayControlMessageType.ForkMemoryGet,
                        { limit: 5 },
                        { id: "fork-memory-missing-1" },
                    ),
                ),
            );

            expect(sent(socket).find((envelope) => envelope.correlationId === "fork-memory-missing-1")).toMatchObject({
                type: GatewayControlMessageType.ForkMemorySnapshot,
                payload: {
                    data: {
                        brainDb: {
                            bytes: null,
                            human: null,
                            status: "unknown",
                        },
                        forks: [],
                    },
                },
            });
            hub.dispose();
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
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

    test("exposes configured model status and resolves known context window tokens", async () => {
        const hub = createHub({
            status: () => ({
                channels: [],
                clientCount: 0,
                context: {
                    compressionThresholdTokens: 360000,
                    hotContextTokens: 100000,
                },
                connectedCount: 1,
                degradedCount: 0,
                gatewayRunning: true,
                host: "127.0.0.1",
                model: {
                    apiMode: "chat-completions",
                    baseUrl: "https://api.openai.com/v1",
                    contextWindowTokens: 320000,
                    headers: {},
                    maxTokens: 4096,
                    model: "gpt-5.5",
                    provider: "openai-compatible",
                    providerId: "openai",
                    temperature: 0.2,
                    timeoutMs: 60_000,
                },
                port: 0,
                streamingCount: 1,
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.GatewayStatusGet,
                    undefined,
                    { id: "status-model-get-1", requestId: "req-status-model-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "status-model-get-1",
            requestId: "req-status-model-1",
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: {
                status: {
                    context: {
                        compressionThresholdTokens: 360000,
                        contextStatus: "available",
                        contextUsedTokens: 100000,
                        contextWindowPercent: 0.3125,
                        currentTokens: 100000,
                        hotContextTokens: 100000,
                        remainingContextTokens: 220000,
                    },
                    model: {
                        contextStatus: "available",
                        contextUsedTokens: 100000,
                        contextWindowPercent: 0.3125,
                        contextWindowTokens: 320000,
                        currentTokens: 100000,
                        maxOutputTokens: 4096,
                        model: "gpt-5.5",
                        provider: "openai-compatible",
                        providerId: "openai",
                    },
                },
            },
        });
        hub.dispose();
    });

    test("uses known model context windows when config does not declare one", async () => {
        const hub = createHub({
            status: () => ({
                channels: [],
                clientCount: 0,
                connectedCount: 1,
                degradedCount: 0,
                gatewayRunning: true,
                host: "127.0.0.1",
                model: {
                    apiMode: "chat-completions",
                    baseUrl: "https://api.openai.com/v1",
                    headers: {},
                    maxTokens: 4096,
                    model: "gpt-5.5",
                    provider: "openai-compatible",
                    providerId: "openai",
                    temperature: 0.2,
                    timeoutMs: 60_000,
                },
                port: 0,
                streamingCount: 1,
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            payload: {
                status: {
                    context: {
                        compressionThresholdTokens: null,
                        contextStatus: "unknown",
                        contextUsedTokens: null,
                        contextWindowPercent: null,
                        currentTokens: null,
                        hotContextTokens: null,
                        remainingContextTokens: null,
                    },
                    model: {
                        contextStatus: "unknown",
                        contextUsedTokens: null,
                        contextWindowPercent: null,
                        contextWindowTokens: 400000,
                        currentTokens: null,
                        maxOutputTokens: 4096,
                        provider: "openai-compatible",
                    },
                },
            },
        });
        hub.dispose();
    });

    test("caches status and DB query snapshots with short-lived hit metadata", async () => {
        let statusReads = 0;
        let historyReads = 0;
        let askReads = 0;
        let jobReads = 0;
        let jobDetailReads = 0;
        const bus = new GlobalEventBus();
        const hub = createHub({
            createContextFork: async (record) => record,
            events: bus,
            queries: fakeQueries({
                askList: () => {
                    askReads += 1;
                    return [{
                        ask: { reason: "other", prompt: `Ask ${askReads}`, freeform: true },
                        event: {
                            id: `ask-${askReads}`,
                            ts: 100,
                            timeBucket: "2026-05-24",
                            ownerKey: "scope:core",
                            type: "ask",
                            content: {},
                            importance: 0.5,
                        },
                        status: "active",
                    }];
                },
                executionJobList: () => {
                    jobReads += 1;
                    return [{
                        children: [],
                        events: [],
                        jobId: `job-${jobReads}`,
                        status: "completed",
                        toolCounts: {},
                        toolExecutions: [],
                    }];
                },
                executionJobDetail: (input) => {
                    expect(input).toEqual({ jobId: "job-1" });
                    jobDetailReads += 1;
                    return {
                        children: [],
                        events: [],
                        jobId: `job-detail-${jobDetailReads}`,
                        status: "completed",
                        toolCounts: {},
                        toolExecutions: [],
                    };
                },
                historyList: () => {
                    historyReads += 1;
                    return [{
                        assistantText: `Assistant ${historyReads}`,
                        eventId: `event-${historyReads}`,
                        ts: 100 + historyReads,
                        userText: "User",
                    }];
                },
            }),
            status: () => {
                statusReads += 1;
                return {
                    channels: [],
                    clientCount: 0,
                    connectedCount: 1,
                    degradedCount: 0,
                    gatewayRunning: true,
                    host: "127.0.0.1",
                    port: statusReads,
                    streamingCount: 1,
                };
            },
        });
        const socket = fakeSocket();
        hub.open(socket);
        statusReads = 0;

        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.HistoryList, { limit: 2 })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.HistoryList, { limit: 2 })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.AskList, { status: "all" })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.AskList, { status: "all" })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobList, { status: "all" })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobList, { status: "all" })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobDetailGet, { jobId: "job-1" })));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ExecutionJobDetailGet, { jobId: "job-1" })));

        expect(statusReads).toBe(1);
        expect(historyReads).toBe(1);
        expect(askReads).toBe(1);
        expect(jobReads).toBe(1);
        expect(jobDetailReads).toBe(1);
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.GatewayStatusSnapshot).slice(-2))
            .toMatchObject([
                { payload: { cache: { hit: false }, status: { cache: { hits: 0, misses: 1 } } } },
                { payload: { cache: { hit: true }, status: { cache: { hits: 1, misses: 1 } } } },
            ]);
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.HistorySnapshot).slice(-2))
            .toMatchObject([
                { payload: { cache: { hit: false }, history: [{ eventId: "event-1" }] } },
                { payload: { cache: { hit: true }, history: [{ eventId: "event-1" }] } },
            ]);
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.AskSnapshot).slice(-2))
            .toMatchObject([
                { payload: { cache: { hit: false }, data: [{ event: { id: "ask-1" } }] } },
                { payload: { cache: { hit: true }, data: [{ event: { id: "ask-1" } }] } },
            ]);
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.ExecutionJobSnapshot).slice(-4, -2))
            .toMatchObject([
                { payload: { cache: { hit: false }, data: [{ jobId: "job-1" }] } },
                { payload: { cache: { hit: true }, data: [{ jobId: "job-1" }] } },
            ]);
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.ExecutionJobSnapshot).slice(-2))
            .toMatchObject([
                { payload: { cache: { hit: false }, data: { jobId: "job-detail-1" } } },
                { payload: { cache: { hit: true }, data: { jobId: "job-detail-1" } } },
            ]);

        bus.publish({
            type: RuntimeEventType.MemoryAskRecorded,
            at: "2026-05-24T00:00:00.000Z",
            payload: { askEventId: "ask-2" },
        });
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.AskList, { status: "all" })));

        expect(askReads).toBe(2);
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.AskSnapshot,
            payload: { cache: { hit: false }, data: [{ event: { id: "ask-2" } }] },
        });

        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        expect(statusReads).toBe(2);
        const statusPair = sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.GatewayStatusSnapshot).slice(-2);
        expect(statusPair).toMatchObject([
            { payload: { cache: { hit: false }, status: { port: 2 } } },
            { payload: { cache: { hit: true }, status: { port: 2 } } },
        ]);
        expect(readStatusCacheHits(statusPair[1])).toBeGreaterThan(readStatusCacheHits(statusPair[0]));

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, {
                    id: "message-cache-invalidate-1",
                    text: "invalidate read cache",
                }),
            ),
        );
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        expect(statusReads).toBe(3);
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: { cache: { hit: false }, status: { port: 3 } },
        });

        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: { cache: { hit: true }, status: { port: 3 } },
        });
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(GatewayControlMessageType.ForkCreate, {
                    title: "Cache invalidation fork",
                    summary: "Invalidate read cache after fork write.",
                }),
            ),
        );
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayStatusGet)));
        expect(statusReads).toBe(4);
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: { cache: { hit: false }, status: { port: 4 } },
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
            queries: fakeQueries({
                historyList: (input) => {
                expect(input).toEqual({ beforeTs: 200, contextForkId: "fork-1", limit: 2 });
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
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.HistoryList,
                    { beforeTs: 200, contextForkId: "fork-1", limit: 2 },
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

    test("keeps context fork history isolated from root history in the query read model", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-fork-history-query-"));
        try {
            const paths = testPaths(root);
            const brain = new BrainStore({ dbPath: join(paths.configDir, "brain.db") });
            await brain.open();
            brain.appendEvent({
                id: "event-root",
                ownerKey: "scope:scope-1",
                sourceKey: "req-root",
                sourceSurface: Channel.Ws,
                ts: 100,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    userText: "root user",
                    assistantText: "root assistant",
                },
            });
            brain.appendEvent({
                id: "event-other-fork",
                ownerKey: "scope:scope-1",
                sourceKey: "req-other-fork",
                sourceSurface: Channel.Ws,
                ts: 150,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    contextForkId: "fork-other",
                    userText: "other fork user",
                    assistantText: "other fork assistant",
                },
            });
            brain.appendEvent({
                id: "event-fork",
                ownerKey: "scope:scope-1",
                sourceKey: "req-fork",
                sourceSurface: Channel.Ws,
                ts: 200,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    contextForkId: "fork-1",
                    userText: "fork user",
                    assistantText: "fork assistant",
                },
            });
            brain.appendEvent({
                id: "event-newer-root",
                ownerKey: "scope:scope-1",
                sourceKey: "req-newer-root",
                sourceSurface: Channel.Ws,
                ts: 300,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    userText: "newer root user",
                    assistantText: "newer root assistant",
                },
            });
            brain.appendEvent({
                id: "event-owned-fork",
                ownerKey: "fork:fork-1",
                sourceKey: "req-owned-fork",
                sourceSurface: Channel.Ws,
                ts: 400,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {
                    userText: "owned fork user",
                    assistantText: "owned fork assistant",
                },
            });
            brain.close();

            const queries = new SocketQueryComponent(paths);
            await queries.initialize();
            expect(queries.historyList({ scopeId: "scope-1", limit: 10 }).map((turn) => turn.eventId)).toEqual(["event-root", "event-newer-root"]);
            expect(queries.historyList({ contextForkId: "fork-1", limit: 10 }).map((turn) => turn.eventId)).toEqual([
                "event-fork",
                "event-owned-fork",
            ]);
            expect(queries.historyList({ contextForkId: "fork-1", limit: 1 }).map((turn) => turn.eventId)).toEqual([
                "event-owned-fork",
            ]);
            expect(queries.historyList({ contextForkId: "fork-1", limit: 2, scopeId: "scope-1" }).map((turn) => turn.eventId)).toEqual([
                "event-fork",
                "event-owned-fork",
            ]);
            queries.dispose();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("keeps empty history.list replay as a ledger boundary with no next cursor", async () => {
        let dispatchCount = 0;
        const hub = createHub({
            dispatch: async (message) => {
                dispatchCount += 1;
                return { messageId: message.id, route: message.route, text: "unexpected" };
            },
            queries: fakeQueries({
                historyList: (input) => {
                expect(input).toEqual({ beforeTs: undefined, limit: 1 });
                return [];
                },
            }),
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

    test("serves DB-backed query snapshots without dispatching a live turn", async () => {
        let dispatchCount = 0;
        const hub = createHub({
            dispatch: async (message) => {
                dispatchCount += 1;
                return { messageId: message.id, route: message.route, text: "unexpected" };
            },
            queries: fakeQueries({
                askList: (input) => {
                    expect(input).toEqual({ status: "all", limit: 5 });
                    return [{
                        ask: {
                            reason: "other",
                            prompt: "Need confirmation?",
                            freeform: true,
                        },
                        event: {
                            id: "ask-1",
                            ts: 100,
                            timeBucket: "2026-05-17",
                            ownerKey: "scope:core",
                            type: "ask",
                            content: {},
                            importance: 0.5,
                        },
                        status: "active",
                    }];
                },
                forkDetail: async (input) => {
                    expect(input).toEqual({ forkId: "fork-1" });
                    return {
                        asks: [],
                        fork: {
                            id: "fork-1",
                            ownerKey: "scope:core",
                            title: "Fork",
                            summary: "Fork summary",
                            continuitySummary: "Fork context",
                            maxContextTokens: 12000,
                            inheritedEventIds: [],
                            createdAt: "2026-05-17T00:00:00.000Z",
                            updatedAt: "2026-05-17T00:00:00.000Z",
                        },
                        inheritedEvents: [],
                        replays: [],
                        taskPlans: [],
                    };
                },
                scopeList: () => [{
                    id: "scope-core",
                    title: "Core",
                    projectDir: "/tmp/core",
                    projectMemoryDir: "/tmp/core/.flyflor/memory",
                    createdAt: 1,
                    updatedAt: 2,
                    lastUsedAt: 3,
                    useCount: 4,
                    codenameIds: ["codename-core"],
                }],
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.AskList,
                    { status: "all", limit: 5 },
                    { id: "ask-list-1" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ForkDetailGet,
                    { forkId: "fork-1" },
                    { id: "fork-detail-1" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.ScopeList, {}, { id: "scope-list-1" })),
        );

        expect(dispatchCount).toBe(0);
        expect(sent(socket).slice(-3)).toMatchObject([
            {
                correlationId: "ask-list-1",
                type: GatewayControlMessageType.AskSnapshot,
                payload: { data: [{ status: "active" }] },
            },
            {
                correlationId: "fork-detail-1",
                type: GatewayControlMessageType.ForkSnapshot,
                payload: { data: { fork: { id: "fork-1" } } },
            },
            {
                correlationId: "scope-list-1",
                type: GatewayControlMessageType.ScopeSnapshot,
                payload: { data: [{ id: "scope-core", codenameIds: ["codename-core"] }] },
            },
        ]);
        hub.dispose();
    });

    test("serves TUI topic context detail chains from query read models", async () => {
        let dispatchCount = 0;
        const hub = createHub({
            dispatch: async (message) => {
                dispatchCount += 1;
                return { messageId: message.id, route: message.route, text: "unexpected" };
            },
            queries: fakeQueries({
                askDetail: (input) => {
                    expect(input).toEqual({ askId: "ask-1" });
                    return {
                        ask: {
                            reason: "other",
                            prompt: "Pick the deploy target?",
                            freeform: true,
                            continuationHint: {
                                title: "Deploy target decision",
                                contextHint: "Waiting on target choice",
                            },
                        },
                        event: {
                            id: "ask-1",
                            ts: 100,
                            timeBucket: "2026-05-24",
                            ownerKey: "scope:core",
                            type: "ask",
                            content: {
                                askId: "ask-1",
                                snapshotId: "snapshot-1",
                                requestId: "req-ask-1",
                                chainDepth: 1,
                            },
                            importance: 0.9,
                        },
                        state: "live",
                        status: "active",
                    };
                },
                blackboardDetail: async (input) => {
                    expect(input).toEqual({ blackboardTurnId: "bb-1" });
                    return {
                        asks: [],
                        forks: [{
                            id: "fork-from-bb",
                            ownerKey: "scope:core",
                            title: "Blackboard fork",
                            summary: "Fork created from blackboard",
                            continuitySummary: "Continue from blackboard decision",
                            maxContextTokens: 12000,
                            inheritedEventIds: ["event-1"],
                            createdAt: "2026-05-24T00:00:00.000Z",
                            updatedAt: "2026-05-24T00:00:00.000Z",
                        }],
                        replays: [],
                        taskPlans: [],
                        turn: {
                            id: "bb-1",
                            scopeId: "scope-1",
                            status: "converged",
                            summary: "Workers converged on a deploy target.",
                            steps: [{ id: "bb-step-1", title: "Compare targets", status: "done" }],
                            decisions: [{ id: "bb-decision-1", title: "Use staging first", status: "accepted" }],
                            messages: [{ role: "assistant", content: "Use staging first." }],
                        } as never,
                    };
                },
                forkDetail: async (input) => {
                    expect(input).toEqual({ forkId: "fork-1" });
                    return {
                        asks: [],
                        fork: {
                            id: "fork-1",
                            ownerKey: "scope:core",
                            scopeId: "scope-1",
                            parentId: "fork-parent",
                            title: "Deploy fork",
                            summary: "Fork summary for selected turn",
                            continuitySummary: "Continue with deploy context",
                            maxContextTokens: 12000,
                            inheritedEventIds: ["event-1"],
                            createdAt: "2026-05-24T00:00:00.000Z",
                            updatedAt: "2026-05-24T00:00:00.000Z",
                            sourceEventId: "event-1",
                        },
                        inheritedEvents: [],
                        replays: [],
                        sourceEvent: {
                            id: "event-1",
                            ts: 90,
                            timeBucket: "2026-05-24",
                            ownerKey: "scope:core",
                            type: "event",
                            content: { title: "Source turn" },
                            importance: 0.5,
                        },
                        taskPlans: [],
                    };
                },
                thoughtDetail: async (input) => {
                    expect(input).toEqual({ eventId: "event-1" });
                    return {
                        event: {
                            id: "event-1",
                            ts: 90,
                            timeBucket: "2026-05-24",
                            ownerKey: "scope:core",
                            type: "event",
                            content: {
                                title: "Recall summary",
                                summary: "Scope memory matched deploy target discussion.",
                                status: "loaded",
                            },
                            importance: 0.6,
                        },
                        forks: [{
                            id: "fork-1",
                            ownerKey: "scope:core",
                            title: "Deploy fork",
                            summary: "Fork summary for selected turn",
                            continuitySummary: "Continue with deploy context",
                            maxContextTokens: 12000,
                            inheritedEventIds: ["event-1"],
                            createdAt: "2026-05-24T00:00:00.000Z",
                            updatedAt: "2026-05-24T00:00:00.000Z",
                        }],
                        replays: [],
                        summary: {
                            hiddenChainOfThought: false,
                            content: {
                                title: "Recall summary",
                                summary: "Scope memory matched deploy target discussion.",
                                status: "loaded",
                            },
                        },
                        taskPlans: [],
                    };
                },
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ThoughtDetailGet,
                    { eventId: "event-1" },
                    { id: "thought-detail-1" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ForkDetailGet,
                    { forkId: "fork-1" },
                    { id: "fork-detail-context-1" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.BlackboardDetailGet,
                    { blackboardTurnId: "bb-1" },
                    { id: "blackboard-detail-1" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.AskDetailGet,
                    { askId: "ask-1" },
                    { id: "ask-detail-1" },
                ),
            ),
        );

        expect(dispatchCount).toBe(0);
        expect(sent(socket).slice(-4)).toMatchObject([
            {
                correlationId: "thought-detail-1",
                type: GatewayControlMessageType.ThoughtSnapshot,
                payload: {
                    data: {
                        event: { id: "event-1" },
                        summary: {
                            hiddenChainOfThought: false,
                            content: {
                                title: "Recall summary",
                                summary: "Scope memory matched deploy target discussion.",
                                status: "loaded",
                            },
                        },
                        forks: [{ id: "fork-1", title: "Deploy fork" }],
                    },
                },
            },
            {
                correlationId: "fork-detail-context-1",
                type: GatewayControlMessageType.ForkSnapshot,
                payload: {
                    data: {
                        fork: {
                            id: "fork-1",
                            title: "Deploy fork",
                            summary: "Fork summary for selected turn",
                            continuitySummary: "Continue with deploy context",
                        },
                    },
                },
            },
            {
                correlationId: "blackboard-detail-1",
                type: GatewayControlMessageType.BlackboardSnapshot,
                payload: {
                    data: {
                        turn: {
                            id: "bb-1",
                            status: "converged",
                            summary: "Workers converged on a deploy target.",
                            steps: [{ id: "bb-step-1", title: "Compare targets", status: "done" }],
                            decisions: [{ id: "bb-decision-1", title: "Use staging first", status: "accepted" }],
                        },
                        forks: [{ id: "fork-from-bb", title: "Blackboard fork" }],
                    },
                },
            },
            {
                correlationId: "ask-detail-1",
                type: GatewayControlMessageType.AskSnapshot,
                payload: {
                    data: {
                        status: "active",
                        state: "live",
                        ask: {
                            prompt: "Pick the deploy target?",
                            continuationHint: {
                                title: "Deploy target decision",
                                contextHint: "Waiting on target choice",
                            },
                        },
                        event: {
                            id: "ask-1",
                            content: {
                                askId: "ask-1",
                                snapshotId: "snapshot-1",
                            },
                        },
                    },
                },
            },
        ]);
        expect(sent(socket).at(-1)?.payload?.data).not.toMatchObject({
            ask: { executiveToolLoop: expect.anything() },
        });
        hub.dispose();
    });

    test("creates a context fork through an injected control callback and returns fork.snapshot", async () => {
        const created: Array<{
            record: ContextForkRecord;
            source?: { assistantText?: string; eventId?: string; userText?: string };
        }> = [];
        const hub = createHub({
            createContextFork: async (record, source) => {
                created.push({ record, source });
                return {
                    ...record,
                    id: "fork-created",
                    createdAt: "2026-05-24T00:00:00.000Z",
                    updatedAt: "2026-05-24T00:00:00.000Z",
                };
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ForkCreate,
                    {
                        title: "TUI fork title",
                        summary: "summary from selected turn",
                        continuitySummary: "summary for future context",
                        maxContextTokens: 12000,
                        inheritedEventIds: ["source-event-id"],
                        sourceEventId: "source-event-id",
                        sourceAskId: "source-ask-id",
                        sourceBlackboardTurnId: "blackboard-turn-id",
                        context: {
                            contextForkId: "current-active-fork-id",
                            activeScope: {
                                id: "scope-id",
                                projectDir: "/tmp/scope",
                                projectMemoryDir: "/tmp/scope/.flyflor/memory",
                                title: "Scope",
                            },
                        },
                    },
                    { id: "fork-create-1", requestId: "req-fork-create-1" },
                ),
            ),
        );

        expect(created).toHaveLength(1);
        expect(created[0]?.record).toMatchObject({
            continuitySummary: "summary for future context",
            inheritedEventIds: ["source-event-id"],
            maxContextTokens: 12000,
            ownerKey: "scope:scope-id",
            parentId: "current-active-fork-id",
            scopeId: "scope-id",
            sourceAskId: "source-ask-id",
            sourceBlackboardTurnId: "blackboard-turn-id",
            sourceEventId: "source-event-id",
            summary: "summary from selected turn",
            title: "TUI fork title",
        });
        expect(created[0]?.source).toEqual({ eventId: "source-event-id" });
        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "fork-create-1",
            requestId: "req-fork-create-1",
            type: GatewayControlMessageType.ForkSnapshot,
            payload: {
                data: {
                    fork: {
                        id: "fork-created",
                        ownerKey: "scope:scope-id",
                        parentId: "current-active-fork-id",
                        scopeId: "scope-id",
                        title: "TUI fork title",
                    },
                },
            },
        });
        expect(sent(socket).at(-1)?.payload).toMatchObject({
            data: {
                fork: {
                    id: "fork-created",
                    sourceEventId: "source-event-id",
                    sourceAskId: "source-ask-id",
                    sourceBlackboardTurnId: "blackboard-turn-id",
                },
            },
        });
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.GatewayStatusGet,
                    undefined,
                    { id: "status-after-fork-create-1", requestId: "req-status-after-fork-create-1" },
                ),
            ),
        );
        expect(sent(socket).at(-1)).toMatchObject({
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: {
                status: {
                    controlState: {
                        activeFork: {
                            id: "fork-created",
                            requestId: "req-fork-create-1",
                            status: "active",
                            title: "TUI fork title",
                        },
                    },
                },
            },
        });
        hub.dispose();
    });

    test("creates fork owner from parent or request when no scope is available", async () => {
        const records: ContextForkRecord[] = [];
        const hub = createHub({
            createContextFork: async (record) => {
                records.push(record);
                return record;
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ForkCreate,
                    {
                        title: "Parent fork",
                        summary: "summary",
                        parentId: "parent-fork",
                    },
                    { id: "fork-create-parent", requestId: "req-parent" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.ForkCreate,
                    {
                        title: "Turn fork",
                        summary: "summary",
                    },
                    { id: "fork-create-turn", requestId: "req-turn" },
                ),
            ),
        );

        expect(records.map((record) => record.ownerKey)).toEqual(["fork:parent-fork", "turn:req-turn"]);
        expect(records[0]?.parentId).toBe("parent-fork");
        expect(records[1]?.parentId).toBeUndefined();
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

    test("returns invalid-payload error for unknown event subscription selectors", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        const subscribe = createGatewayControlEnvelope(
            GatewayControlMessageType.EventSubscribe,
            {
                classes: ["unknown-class"],
                types: ["runtime.unknown"],
            },
            { id: "event-sub-invalid-1", requestId: "req-sub-invalid-1" },
        );
        await hub.message(socket, JSON.stringify(subscribe));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "event-sub-invalid-1",
            requestId: "req-sub-invalid-1",
            type: GatewayControlMessageType.Error,
            payload: {
                code: GatewayControlErrorCode.InvalidPayload,
                details: { class: "unknown-class" },
                message: "event subscription classes must use known runtime event classes",
            },
        });

        bus.publish({
            type: RuntimeEventType.ChannelError,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "runtime-req-1",
            payload: { channel: Channel.Ws, error: "boom" },
        });
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toHaveLength(0);
        hub.dispose();
    });

    test("returns invalid-payload error for unknown event subscription types", async () => {
        const bus = new GlobalEventBus();
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        const subscribe = createGatewayControlEnvelope(
            GatewayControlMessageType.EventSubscribe,
            {
                types: ["runtime.unknown"],
            },
            { id: "event-sub-invalid-type-1", requestId: "req-sub-invalid-type-1" },
        );
        await hub.message(socket, JSON.stringify(subscribe));

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "event-sub-invalid-type-1",
            requestId: "req-sub-invalid-type-1",
            type: GatewayControlMessageType.Error,
            payload: {
                code: GatewayControlErrorCode.InvalidPayload,
                details: { type: "runtime.unknown" },
                message: "event subscription types must use known runtime event types",
            },
        });

        bus.publish({
            type: RuntimeEventType.ChannelError,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "runtime-req-1",
            payload: { channel: Channel.Ws, error: "boom" },
        });
        expect(sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toHaveLength(0);
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

    test("delivers failed tool lifecycle events through the error event class", async () => {
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
                        classes: ["error"],
                    },
                    { id: "event-sub-tool-error-1", requestId: "req-sub-tool-error-1" },
                ),
            ),
        );

        bus.publish({
            type: RuntimeEventType.ToolFailed,
            at: "2026-05-24T00:01:00.000Z",
            requestId: "runtime-req-tool-failed-1",
            payload: {
                capabilityKind: CapabilityExecutionKind.McpTool,
                error: "tool failed",
                key: "workspace.read",
            },
        });

        expect(sent(socket).find((envelope) => envelope.type === GatewayControlMessageType.EventPublish)).toMatchObject({
            type: GatewayControlMessageType.EventPublish,
            payload: {
                event: {
                    type: RuntimeEventType.ToolFailed,
                    requestId: "runtime-req-tool-failed-1",
                    payload: {
                        error: "tool failed",
                        key: "workspace.read",
                    },
                },
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
                            toolApprovals: {
                                mcpToolCalls: true,
                                userToolCalls: true,
                            },
                        },
                        metadata: {
                            interaction: {
                                mode: "plan",
                                yolo: true,
                            },
                            tui: {
                                mode: "chat",
                            },
                            uiMode: "plan",
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
            metadata: {
                tui: {
                    mode: "chat",
                },
                interaction: {
                    mode: "plan",
                    yolo: true,
                },
                uiMode: "plan",
            },
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
        expect(calls[0]?.options?.sandboxMode).toBe(SandboxMode.Yolo);
        expect(calls[0]?.options?.interactionMode).toBe("plan");
        expect(await calls[0]?.options?.approveMcpToolCall?.({ server: "workspace", tool: "write", input: {} })).toBe(true);
        expect(await calls[0]?.options?.approveUserToolCall?.({ descriptor: { name: "user.tool" } } as never)).toBe(true);
        expect(sent(socket)[1]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnDelta,
            payload: {
                delta: "hel",
                messageId: calls[0]?.message.metadata?.clientMessageId,
            },
        });
        expect(sent(socket)[2]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnDelta,
            payload: {
                delta: "lo",
                messageId: calls[0]?.message.metadata?.clientMessageId,
            },
        });
        expect(sent(socket)[3]).toMatchObject({
            correlationId: "send-live-1",
            requestId: "client-req-1",
            type: GatewayControlMessageType.TurnFinal,
            payload: {
                reply: {
                    messageId: calls[0]?.message.metadata?.clientMessageId,
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

    test("handles task.plan.decide as the control boundary for plan decisions", async () => {
        const published: RuntimeEventType[] = [];
        const plan: TaskPlanRecord = {
            id: "plan-1",
            ownerKey: "turn:req-1",
            sourceKey: "turn:req-1",
            title: "Draft",
            summary: "Original summary",
            status: TaskPlanStatus.Waiting,
            progress: 0,
            stepCount: 1,
            completedStepCount: 0,
            step: [{ id: "step-1", title: "Step", status: TaskPlanStatus.Waiting, order: 0, progress: 0 }],
            createdAt: "2026-05-24T00:00:00.000Z",
            updatedAt: "2026-05-24T00:00:00.000Z",
        };
        let currentPlan = plan;
        const bus = new GlobalEventBus();
        bus.subscribe({ publish: (runtimeEvent) => published.push(runtimeEvent.type as RuntimeEventType) });
        const hub = createHub({
            events: bus,
            queries: fakeQueries({
                taskPlanDecide: (input) => {
                    const status = input.action === TaskPlanDecisionAction.Confirm
                        ? TaskPlanStatus.InProgress
                        : input.action === TaskPlanDecisionAction.Revise
                          ? TaskPlanStatus.Waiting
                          : TaskPlanStatus.Blocked;
                    currentPlan = {
                        ...currentPlan,
                        status,
                        summary: input.revision ? `${currentPlan.summary}\n\nRevision: ${input.revision}` : currentPlan.summary,
                    };
                    return currentPlan;
                },
            }),
        });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(
            GatewayControlMessageType.TaskPlanDecide,
            { planId: "plan-1", action: TaskPlanDecisionAction.Confirm },
            { id: "task-confirm-1", requestId: "req-task-confirm-1" },
        )));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(
            GatewayControlMessageType.TaskPlanDecide,
            { planId: "plan-1", action: TaskPlanDecisionAction.Revise, revision: "Add verification." },
            { id: "task-revise-1", requestId: "req-task-revise-1" },
        )));
        await hub.message(socket, JSON.stringify(createGatewayControlEnvelope(
            GatewayControlMessageType.TaskPlanDecide,
            { planId: "plan-1", action: TaskPlanDecisionAction.Abandon },
            { id: "task-abandon-1", requestId: "req-task-abandon-1" },
        )));

        const snapshots = sent(socket).filter((envelope) => envelope.type === GatewayControlMessageType.TaskSnapshot);
        expect(snapshots.map((envelope) => (envelope.payload as { data?: { taskPlan?: { status?: string } } })?.data?.taskPlan?.status)).toEqual([
            TaskPlanStatus.InProgress,
            TaskPlanStatus.Waiting,
            TaskPlanStatus.Blocked,
        ]);
        expect((snapshots[1]?.payload as { data?: { taskPlan?: { summary?: string } } })?.data?.taskPlan?.summary)
            .toContain("Revision: Add verification.");
        expect(published.filter((type) => type === RuntimeEventType.MemoryTaskPlanDecided)).toHaveLength(3);
        hub.dispose();
    });

    test("emits yolo audit events around ws dispatch when requested by structured metadata", async () => {
        const bus = new GlobalEventBus();
        const published: string[] = [];
        bus.subscribe({ publish: (runtimeEvent) => published.push(runtimeEvent.type) });
        const hub = createHub({ events: bus });
        const socket = fakeSocket();
        hub.open(socket);

        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.GatewayMessageSend,
                    {
                        metadata: { tui: { yolo: true } },
                        text: "run with yolo",
                    },
                    { id: "send-yolo-audit-1", requestId: "req-yolo-audit-1" },
                ),
            ),
        );

        expect(published).toContain(RuntimeEventType.SandboxYoloEntered);
        expect(published).toContain(RuntimeEventType.SandboxYoloExited);
        hub.dispose();
    });

    test("keeps client message ids as public anchors while dispatching unique internal ids", async () => {
        const calls: GatewayMessage[] = [];
        const hub = createHub({
            dispatch: async (message, options) => {
                calls.push(message);
                await options?.onTextDelta?.("ok");
                return { messageId: message.id, route: message.route, text: "done" };
            },
        });
        const socket = fakeSocket();
        hub.open(socket);
        const payload = {
            id: "message-1",
            text: "repeatable Apifox example id",
            user: { id: "u-1" },
        };

        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, payload, { id: "send-a", requestId: "req-a" })),
        );
        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(GatewayControlMessageType.GatewayMessageSend, payload, { id: "send-b", requestId: "req-b" })),
        );

        expect(calls).toHaveLength(2);
        expect(calls[0]?.id).not.toBe("message-1");
        expect(calls[1]?.id).not.toBe("message-1");
        expect(calls[0]?.id).not.toBe(calls[1]?.id);
        const publicFrames = sent(socket).filter((envelope) =>
            envelope.type === GatewayControlMessageType.TurnDelta || envelope.type === GatewayControlMessageType.TurnFinal
        );
        expect(publicFrames.map((envelope) => (envelope.payload as { messageId?: string; reply?: { messageId?: string } }).messageId ?? (envelope.payload as { reply?: { messageId?: string } }).reply?.messageId)).toEqual([
            "message-1",
            "message-1",
            "message-1",
            "message-1",
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

    test("interrupts an active gateway message through AbortSignal", async () => {
        let releaseStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            releaseStarted = resolve;
        });
        let aborted = false;
        const hub = createHub({
            dispatch: async (_message, options) => {
                releaseStarted();
                return await new Promise<GatewayReply>((_resolve, reject) => {
                    options?.signal?.addEventListener("abort", () => {
                        aborted = true;
                        const error = new Error("The operation was stopped.");
                        error.name = "AbortError";
                        reject(error);
                    });
                });
            },
        });
        const socket = fakeSocket();
        hub.open(socket);

        const sendPromise = hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(
                GatewayControlMessageType.GatewayMessageSend,
                { id: "message-interrupt-1", text: "long task" },
                { id: "send-interrupt-1", requestId: "req-interrupt-1" },
            )),
        );
        await started;
        await hub.message(
            socket,
            JSON.stringify(createGatewayControlEnvelope(
                GatewayControlMessageType.GatewayMessageInterrupt,
                { messageId: "message-interrupt-1" },
                { id: "interrupt-1", requestId: "req-interrupt-command-1" },
            )),
        );
        await sendPromise;

        expect(aborted).toBe(true);
        expect(sent(socket).some((envelope) =>
            envelope.type === GatewayControlMessageType.Ack
            && (envelope.payload as { interrupted?: number }).interrupted === 1
        )).toBe(true);
        expect(sent(socket).at(-1)).toMatchObject({
            requestId: "req-interrupt-1",
            type: GatewayControlMessageType.TurnError,
            payload: {
                message: "The operation was stopped.",
                messageId: "message-interrupt-1",
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
                                loopGuardSnapshot: {
                                    callRepeatCounts: {},
                                    failedCallRepeatCounts: {},
                                    totalCalls: 2,
                                    unknownToolCounts: {},
                                },
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
                                loopGuardSnapshot: {
                                    callRepeatCounts: {},
                                    failedCallRepeatCounts: {},
                                    totalCalls: 2,
                                    unknownToolCounts: {},
                                },
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

    test("exposes live ASK, Scope, Fork, and Executive loop snapshots through gateway.status.get", async () => {
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
                            loopGuardSnapshot: {
                                callRepeatCounts: {},
                                failedCallRepeatCounts: {},
                                totalCalls: 2,
                                unknownToolCounts: {},
                            },
                            message: "Need one more step",
                            resume: { mode: "continue", requestId: "client-req-ask" },
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
                    executiveToolLoop: {
                        askId: "ask-1",
                        loopGuardSnapshot: {
                            callRepeatCounts: {},
                            failedCallRepeatCounts: {},
                            totalCalls: 2,
                            unknownToolCounts: {},
                        },
                        message: "Need one more step",
                        resume: { mode: "continue", requestId: "client-req-ask" },
                        stepCount: 2,
                        stop: "ask",
                        toolBudgetExhausted: true,
                    },
                    planning: {
                        contextForks: [{
                            id: "fork-1",
                            continuitySummary: "Keep socket control context visible.",
                            maxContextTokens: 12000,
                            title: "Socket control fork",
                        }],
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
                            contextForkId: "fork-1",
                        },
                        id: "message-ask-1",
                        text: "hello",
                        user: { id: "u-1" },
                    },
                    { id: "send-ask-1", requestId: "client-req-ask" },
                ),
            ),
        );
        await hub.message(
            socket,
            JSON.stringify(
                createGatewayControlEnvelope(
                    GatewayControlMessageType.GatewayStatusGet,
                    undefined,
                    { id: "status-after-ask-1", requestId: "req-status-after-ask-1" },
                ),
            ),
        );

        expect(sent(socket).at(-1)).toMatchObject({
            correlationId: "status-after-ask-1",
            type: GatewayControlMessageType.GatewayStatusSnapshot,
            payload: {
                status: {
                    controlState: {
                        activeAsk: {
                            messageId: "message-ask-1",
                            requestId: "client-req-ask",
                            status: "active",
                            ask: {
                                executiveToolLoop: {
                                    askId: "ask-1",
                                    stop: "ask",
                                },
                                prompt: "Need confirmation?",
                                snapshotId: "snapshot-1",
                            },
                        },
                        activeFork: {
                            id: "fork-1",
                            requestId: "client-req-ask",
                            status: "active",
                            title: "Socket control fork",
                        },
                        activeScope: {
                            id: "scope-1",
                            projectDir: "/tmp/scope",
                            projectMemoryDir: "/tmp/scope/.flyflor/memory",
                            title: "Scope",
                        },
                        executiveLoop: {
                            askId: "ask-1",
                            requestId: "client-req-ask",
                            status: "paused",
                            stop: "ask",
                            toolBudgetExhausted: true,
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
        queries: fakeQueries(),
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

function fakeQueries(overrides: Partial<SocketQueryComponentPort> = {}): SocketQueryComponentPort {
    return {
        askDetail: () => undefined,
        askList: () => [],
        blackboardDetail: async () => undefined,
        blackboardList: async () => [],
        crystalList: () => [],
        executionJobDetail: () => undefined,
        executionJobList: () => [],
        forkDetail: async () => undefined,
        forkList: () => [],
        forkMemory: async () => ({ brainDb: { bytes: null, human: null, status: "unknown" }, forks: [] }),
        historyDetail: async () => undefined,
        historyList: () => [],
        initialize: async () => undefined,
        replayDetail: async () => undefined,
        replayList: () => [],
        scopeDetail: () => undefined,
        scopeList: () => [],
        taskDetail: () => undefined,
        taskPlanDecide: () => undefined,
        taskList: () => [],
        thoughtDetail: async () => undefined,
        ...overrides,
    };
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

function readStatusCacheHits(envelope?: GatewayControlEnvelope): number {
    const payload = envelope?.payload as { status?: { cache?: { hits?: unknown } } } | undefined;
    const hits = payload?.status?.cache?.hits;
    return typeof hits === "number" ? hits : 0;
}

function eventTypeFromEnvelope(envelope: GatewayControlEnvelope): string | undefined {
    const payload = envelope.payload as { event?: { type?: unknown } } | undefined;
    return typeof payload?.event?.type === "string" ? payload.event.type : undefined;
}

function eventPayloadFromEnvelope(envelope: GatewayControlEnvelope): unknown {
    const payload = envelope.payload as { event?: { payload?: unknown } } | undefined;
    return payload?.event?.payload;
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

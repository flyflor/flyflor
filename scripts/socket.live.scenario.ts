#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SocketModule } from "../src/socket/module.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { createModelClient } from "../src/cognitive/mindstream/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import {
    loadConfig,
    loadConfigForPaths,
    readModelProviderReadiness,
    type FlyflorConfig,
    type FlyflorPaths,
} from "../src/config/index.ts";
import {
    createGatewayControlEnvelope,
    type GatewayControlCapabilityCatalogPayload,
    type GatewayControlEnvelope,
    type GatewayControlEventPublishPayload,
    type GatewayControlGatewayStatusPayload,
    type GatewayControlHistorySnapshotPayload,
    type GatewayControlServerHelloPayload,
    type GatewayControlTurnDeltaPayload,
    type GatewayControlTurnFinalPayload,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    RuntimeEventClass,
    type GatewayMessage,
} from "../src/protocol/contracts/index.ts";
import { EventsComponent, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";

interface SocketLiveScenarioReport {
    capabilityKitIds: string[];
    eventTypes: string[];
    eventPublishTypes: string[];
    failedChecks: string[];
    finalText: string;
    historyCount: number;
    historyKinds: string[];
    helloClientId: string;
    helloCommandCount: number;
    ok: boolean;
    replayKinds: string[];
    statusUrl: string;
    tempHome: string;
    turnDeltaText: string;
}

async function main(): Promise<void> {
    const report = await new SocketLiveScenario().run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
        process.exitCode = 1;
    }
}

class SocketLiveScenario {
    private root = "";
    private socket: SocketModule | undefined;
    private runtime: RuntimeModule | undefined;
    private providerConfig: FlyflorConfig | undefined;
    private config: FlyflorConfig | undefined;

    public async run(): Promise<SocketLiveScenarioReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-socket-live-scenario-"));
        try {
            const config = await this.createIsolatedConfig();
            this.config = config;
            const readiness = readModelProviderReadiness(this.providerConfig ?? config);
            if (!readiness.ready) {
                throw new Error(
                    `Configured provider is not ready: ${JSON.stringify({
                        configDir: readiness.configDir,
                        detail: readiness.detail,
                        model: readiness.model,
                        providerId: readiness.providerId,
                        state: readiness.state,
                    })}`,
                );
            }

            const sink = new RecordingSink();
            const events = new EventsComponent(sink, new RuntimeEventBus());
            const memory = new MemoryModule(config, events);
            this.runtime = new RuntimeModule(config, createModelClient(config.model), events, undefined, memory);
            this.socket = new SocketModule(config.gateway, this.runtime, events, { paths: config.paths });
            this.socket.start();

            const url = this.socket.getStatusSnapshot().url;
            if (!url) {
                throw new Error("Socket did not expose a ws url");
            }

            const ws = new WebSocket(`${url}ws`);
            const received: GatewayControlEnvelope[] = [];
            const stopCollecting = startCollecting(ws, received);
            await waitForOpen(ws);

            const serverHello = await waitForType(received, GatewayControlMessageType.ServerHello);
            const hello = serverHello.payload as GatewayControlServerHelloPayload;

            send(
                ws,
                GatewayControlMessageType.ClientHello,
                {
                    capabilities: { ui: "live-smoke" },
                    clientId: "socket-live-client",
                    name: "Socket Live Smoke",
                    version: "0.1.0",
                },
                { id: "client-hello-1", requestId: "req-client-hello-1" },
            );
            await waitForType(
                received,
                GatewayControlMessageType.Ack,
                (envelope) => envelope.correlationId === "client-hello-1",
            );

            send(
                ws,
                GatewayControlMessageType.EventSubscribe,
                {
                    classes: [RuntimeEventClass.Ask, RuntimeEventClass.Control, RuntimeEventClass.Lifecycle],
                    types: [RuntimeEventType.AgentTurnStart, RuntimeEventType.AgentTurnEnd],
                },
                { id: "subscribe-1", requestId: "req-subscribe-1" },
            );
            await waitForType(
                received,
                GatewayControlMessageType.Ack,
                (envelope) => envelope.correlationId === "subscribe-1",
            );

            send(ws, GatewayControlMessageType.GatewayStatusGet, undefined, {
                id: "status-1",
                requestId: "req-status-1",
            });
            const statusEnvelope = await waitForType(received, GatewayControlMessageType.GatewayStatusSnapshot);
            const status = statusEnvelope.payload as GatewayControlGatewayStatusPayload;

            send(ws, GatewayControlMessageType.CapabilityCatalogGet, undefined, {
                id: "catalog-1",
                requestId: "req-catalog-1",
            });
            const catalogEnvelope = await waitForType(received, GatewayControlMessageType.CapabilityCatalogSnapshot);
            const capabilityKitIds = readCapabilityKitIds(
                catalogEnvelope.payload as GatewayControlCapabilityCatalogPayload | undefined,
            );

            const message = this.message();
            send(ws, GatewayControlMessageType.GatewayMessageSend, message, { id: "turn-1", requestId: "req-turn-1" });
            const firstDeltaEnvelope = await waitForType(
                received,
                GatewayControlMessageType.TurnDelta,
                (envelope) => envelope.requestId === "req-turn-1",
            );
            const finalEnvelope = await waitForType(
                received,
                GatewayControlMessageType.TurnFinal,
                (envelope) => envelope.requestId === "req-turn-1",
            );
            const final = finalEnvelope.payload as GatewayControlTurnFinalPayload;
            const delta = firstDeltaEnvelope.payload as GatewayControlTurnDeltaPayload;

            send(
                ws,
                GatewayControlMessageType.HistoryList,
                { limit: 5 },
                { id: "history-1", requestId: "req-history-1" },
            );
            const historyEnvelope = await waitForType(received, GatewayControlMessageType.HistorySnapshot);
            const history = historyEnvelope.payload as GatewayControlHistorySnapshotPayload;

            ws.close();
            stopCollecting();

            const historyKinds = history.history.map((entry) => String(entry.metadata?.kind ?? "unknown"));
            const replayKinds = history.history.flatMap((entry) =>
                (entry.replays ?? []).map((replay) => String(replay.kind)),
            );
            const historyMatchesFinal = history.history.some(
                (entry) =>
                    entry.assistantText.trim() === final.reply.text.trim() || entry.eventId === final.reply.messageId,
            );
            const eventTypes = sink.types;
            const eventPublishTypes = received
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) =>
                    String(
                        (
                            (envelope.payload as GatewayControlEventPublishPayload | undefined)?.event as
                                | { type?: string }
                                | undefined
                        )?.type ?? "",
                    ),
                );
            const failedChecks = collectFailedChecks({
                capabilityKitIds,
                delta,
                eventPublishTypes,
                eventTypes,
                final,
                hello,
                historyCount: history.history.length,
                historyMatchesFinal,
                status,
                url,
            });
            const ok = failedChecks.length === 0;

            return {
                capabilityKitIds,
                eventTypes,
                eventPublishTypes,
                failedChecks,
                finalText: final.reply.text,
                historyCount: history.history.length,
                historyKinds,
                helloClientId: hello.clientId,
                helloCommandCount: hello.capabilities.commands.length,
                ok,
                replayKinds,
                statusUrl: url,
                tempHome: config.paths.home,
                turnDeltaText: delta.delta,
            };
        } finally {
            this.socket?.stop();
            this.runtime?.dispose();
            await rm(this.root, { recursive: true, force: true });
        }
    }

    private async createIsolatedConfig(): Promise<FlyflorConfig> {
        const providerConfig = await this.loadProviderConfig();
        this.providerConfig = providerConfig;
        const paths = this.paths();
        const repoRoot = resolve(import.meta.dir, "..");
        await mkdir(dirname(paths.promptDir), { recursive: true });
        await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
        await mkdir(dirname(paths.templateDir), { recursive: true });
        await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
        await mkdir(paths.projectDir, { recursive: true });
        await Bun.write(join(paths.projectDir, "live.note.txt"), "socket live scenario note\n");

        const config = await loadConfigForPaths(paths);
        config.model = providerConfig.model;
        config.gateway.host = "127.0.0.1";
        config.gateway.port = 0;
        config.gateway.stdio = false;
        return config;
    }

    private async loadProviderConfig(): Promise<FlyflorConfig> {
        return Bun.env.FLYFLOR_LIVE_TEST_CONFIG === "docker"
            ? await loadConfigForPaths(this.dockerConfigPaths())
            : await loadConfig();
    }

    private dockerConfigPaths(): FlyflorPaths {
        const root = resolve(import.meta.dir, "..");
        const configDir = join(root, "docker", "config");
        const workspaceDir = join(root, "docker", "workspace");
        return {
            home: configDir,
            configDir,
            storageDir: join(workspaceDir, ".flyflor", "data"),
            cacheDir: join(workspaceDir, ".flyflor", "cache"),
            projectDir: workspaceDir,
            projectFlyflorDir: join(workspaceDir, ".flyflor"),
            projectSkillDir: join(workspaceDir, ".flyflor", "skills"),
            projectMcpDir: join(workspaceDir, ".flyflor", "mcp"),
            projectPluginDir: join(workspaceDir, ".flyflor", "plugins"),
            projectMemoryDir: join(workspaceDir, ".flyflor", "memory"),
            workspaceDir,
            logDir: join(configDir, "logs"),
            memoryDir: join(workspaceDir, ".flyflor", "memory"),
            pluginDir: join(configDir, "plugins"),
            promptDir: join(configDir, "prompts"),
            skillDir: join(configDir, "skills"),
            templateDir: join(configDir, "templates"),
            mcpDir: join(configDir, "mcp"),
        };
    }

    private paths(): FlyflorPaths {
        const home = join(this.root, "home");
        const project = join(this.root, "workspace");
        return {
            home,
            configDir: home,
            storageDir: join(home, "storage"),
            cacheDir: join(home, "cache"),
            workspaceDir: project,
            logDir: join(home, "logs"),
            memoryDir: join(project, ".flyflor", "memory"),
            projectDir: project,
            projectFlyflorDir: join(project, ".flyflor"),
            projectMemoryDir: join(project, ".flyflor", "memory"),
            projectSkillDir: join(project, ".flyflor", "skills"),
            projectMcpDir: join(project, ".flyflor", "mcp"),
            projectPluginDir: join(project, ".flyflor", "plugins"),
            pluginDir: join(home, "plugins"),
            promptDir: join(home, "prompts"),
            skillDir: join(home, "skills"),
            templateDir: join(home, "templates"),
            mcpDir: join(home, "mcp"),
        };
    }

    private message(): GatewayMessage {
        return {
            id: "socket-live-message",
            receivedAt: new Date().toISOString(),
            text: "This is a live socket transport smoke. Reply with one concise sentence: socket live scenario ok.",
            attachments: [],
            user: { id: "socket-live-user", displayName: "Socket Live User" },
            route: { channel: Channel.Ws, chatType: ChatType.Direct, conversationKey: "socket-live-scenario" },
            metadata: {
                source: "socket-live-scenario",
            },
        };
    }
}

class RecordingSink {
    public readonly events: Array<{ type: string }> = [];

    public publish(event: Parameters<EventSink["publish"]>[0]): void {
        this.events.push({ type: event.type });
    }

    public get types(): string[] {
        return this.events.map((event) => event.type);
    }
}

function readCapabilityKitIds(payload: GatewayControlCapabilityCatalogPayload | undefined): string[] {
    const kits = payload?.kits;
    if (!kits || !Array.isArray(kits.kits)) {
        return [];
    }
    return kits.kits.map((kit) => kit.id).filter((id): id is string => typeof id === "string");
}

function collectFailedChecks(input: {
    capabilityKitIds: string[];
    delta: GatewayControlTurnDeltaPayload;
    eventPublishTypes: string[];
    eventTypes: string[];
    final: GatewayControlTurnFinalPayload;
    hello: GatewayControlServerHelloPayload;
    historyCount: number;
    historyMatchesFinal: boolean;
    status: GatewayControlGatewayStatusPayload;
    url: string;
}): string[] {
    const checks: Array<[string, boolean]> = [
        [
            "server.hello advertised client.hello",
            input.hello.capabilities.commands.includes(GatewayControlMessageType.ClientHello),
        ],
        [
            "server.hello advertised capability.catalog.get",
            input.hello.capabilities.commands.includes(GatewayControlMessageType.CapabilityCatalogGet),
        ],
        [
            "server.hello advertised gateway.message.send",
            input.hello.capabilities.commands.includes(GatewayControlMessageType.GatewayMessageSend),
        ],
        [
            "server.hello advertised history.list",
            input.hello.capabilities.commands.includes(GatewayControlMessageType.HistoryList),
        ],
        [
            "server.hello advertised gateway.status.get",
            input.hello.capabilities.commands.includes(GatewayControlMessageType.GatewayStatusGet),
        ],
        ["status reports running socket", input.status.status.gatewayRunning === true],
        ["status returns the active websocket url", input.status.status.url === input.url],
        ["capability catalog includes builtin gateway kit", input.capabilityKitIds.includes("builtin.gateway")],
        ["capability catalog includes builtin capability kit", input.capabilityKitIds.includes("builtin.capabilities")],
        ["turn.delta carried provider text", input.delta.delta.trim().length > 0],
        ["turn.final carried provider text", input.final.reply.text.trim().length > 0],
        ["history.list returned at least one turn", input.historyCount > 0],
        ["history.list replay includes the live final reply", input.historyMatchesFinal],
        ["event sink observed gateway.start", input.eventTypes.includes(RuntimeEventType.GatewayStart)],
        ["event sink observed agent.turn.start", input.eventTypes.includes(RuntimeEventType.AgentTurnStart)],
        ["event sink observed agent.turn.end", input.eventTypes.includes(RuntimeEventType.AgentTurnEnd)],
        [
            "socket event stream published agent.turn.start",
            input.eventPublishTypes.includes(RuntimeEventType.AgentTurnStart),
        ],
        [
            "socket event stream published agent.turn.end",
            input.eventPublishTypes.includes(RuntimeEventType.AgentTurnEnd),
        ],
    ];
    return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

function send(
    ws: WebSocket,
    type: GatewayControlMessageType,
    payload?: object,
    options: { id: string; requestId: string } = { id: crypto.randomUUID(), requestId: crypto.randomUUID() },
): void {
    ws.send(
        JSON.stringify(createGatewayControlEnvelope(type, payload as Record<string, unknown> | undefined, options)),
    );
}

function startCollecting(ws: WebSocket, received: GatewayControlEnvelope[]): () => void {
    const onMessage = (event: MessageEvent<string>) => {
        received.push(JSON.parse(event.data) as GatewayControlEnvelope);
    };
    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket failed to open"));
    });
}

async function waitForType(
    received: GatewayControlEnvelope[],
    type: GatewayControlMessageType,
    predicate?: (envelope: GatewayControlEnvelope) => boolean,
): Promise<GatewayControlEnvelope> {
    const deadline = Date.now() + 120_000;
    while (true) {
        const existing = received.find((envelope) => envelope.type === type && (!predicate || predicate(envelope)));
        if (existing) {
            return existing;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${type}. Received: ${received.map((item) => item.type).join(", ")}`);
        }
        await Bun.sleep(25);
    }
}

await main();

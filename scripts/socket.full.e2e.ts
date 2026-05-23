#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { createModelClient } from "../src/cognitive/mindstream/index.ts";
import { loadConfig, loadConfigForPaths, readModelProviderReadiness, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { EventsComponent, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { SocketModule } from "../src/socket/module.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    GatewayControlProtocol,
    MemoryEventType,
    ModelRole,
    ReplayRecordKind,
    TaskPlanStatus,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
} from "../src/protocol/contracts/index.ts";
import type { GatewayControlEnvelope } from "../src/protocol/control/index.ts";

interface Report {
    ok: boolean;
    failedChecks: string[];
    eventTypes: string[];
    queryTypes: string[];
    scopeRecallEvents: string[];
    tempHome: string;
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string }> = [];
    public publish(evt: { type: string }): void {
        this.events.push({ type: evt.type });
    }
    public get types(): string[] {
        return this.events.map((event) => event.type);
    }
}

class ScriptedE2EModel implements ModelClient {
    public async generate(messages: ModelMessage[]): Promise<string> {
        const system = messages[0]?.content ?? "";
        if (system.includes("Task: decide whether the current user request refers to one existing named work context.")) {
            return JSON.stringify({
                decision: "load",
                scopeId: SCOPE_ID,
                confidence: 0.9,
                candidateScopeIds: [SCOPE_ID],
                reason: "The request refers to the named existing socket e2e scope.",
                askPrompt: null,
            });
        }
        if (system.includes("Decide how the agent should handle")) {
            return JSON.stringify({
                mode: "direct",
                score: 0.2,
                reason: "scripted e2e direct",
                signals: [],
                needsReflectionCandidate: false,
                blackboardContract: { mode: "normal", policyReason: "scripted", evidence: [], contradictions: [] },
                workers: [],
            });
        }
        return "已回忆并装配 Flyflor Socket E2E scope。";
    }
}

const root = await mkdtemp(join(tmpdir(), "flyflor-socket-full-e2e-"));
const SCOPE_ID = `scope-${new Bun.CryptoHasher("sha256").update(projectPathFor(root)).digest("hex").slice(0, 16)}`;
let socket: SocketModule | undefined;
let runtime: RuntimeModule | undefined;

try {
    const config = await createIsolatedConfig(root);
    const providerReady = readModelProviderReadiness(await loadConfig());
    const model = providerReady.ready ? createModelClient(config.model) : new ScriptedE2EModel();
    const sink = new RecordingSink();
    const events = new EventsComponent(sink, new RuntimeEventBus());
    const memory = new MemoryModule(config, events, model);
    runtime = new RuntimeModule(config, model, events, undefined, memory);
    await runtime.warmup();

    const scope = await runtime.createOrUseScope({
        path: config.paths.projectDir,
        title: "Flyflor Socket E2E",
        goal: "Validate WS full closure: recall, ask, history, fork, task, replay, thought and crystal query surfaces.",
        sourceKey: "socket-full-e2e",
    });

    const ctx = { requestId: "req-seed", now: new Date().toISOString(), activeScope: scope };
    const sourceEventId = crypto.randomUUID();
    const brain = (memory as unknown as { brain: { appendEvent: (input: unknown) => void } }).brain;
    brain.appendEvent({
        id: sourceEventId,
        ts: Date.now(),
        ownerKey: `scope:${scope.id}`,
        sourceKey: "socket-full-e2e",
        sourceSurface: Channel.Ws,
        type: MemoryEventType.Thought,
        role: ModelRole.Assistant,
        content: { summary: "Deep-think fixture for expandable TUI thought panel." },
        importance: 0.7,
    });
    memory.recordTurnPlanning({
        ownerKey: `scope:${scope.id}`,
        sourceKey: "socket-full-e2e",
        requestId: "req-seed",
        sourceEventId,
        taskPlans: [
            {
                id: "task-full-e2e",
                ownerKey: `scope:${scope.id}`,
                title: "WS full e2e",
                summary: "Exercise query-only TUI read models.",
                status: TaskPlanStatus.InProgress,
                progress: 0.5,
                stepCount: 2,
                completedStepCount: 1,
                step: [
                    { id: "step-1", title: "Seed scope", order: 1, status: TaskPlanStatus.Done },
                    { id: "step-2", title: "Query snapshots", order: 2, status: TaskPlanStatus.InProgress },
                ],
                createdAt: ctx.now,
                updatedAt: ctx.now,
            },
        ],
        contextForks: [
            {
                id: "fork-full-e2e",
                ownerKey: `scope:${scope.id}`,
                scopeId: scope.id,
                title: "WS query fork",
                summary: "Fork fixture",
                continuitySummary: "Preserve expandable fork details.",
                maxContextTokens: 12000,
                inheritedEventIds: [sourceEventId],
                createdAt: ctx.now,
                updatedAt: ctx.now,
            },
        ],
        replayRecords: [
            {
                id: "replay-full-e2e",
                ownerKey: `scope:${scope.id}`,
                kind: ReplayRecordKind.DeepThink,
                title: "Thought replay",
                summary: "Replay fixture",
                visibleFacts: ["Thought summary is query-only."],
                openQuestions: [],
                contextForkId: "fork-full-e2e",
                sourceEventId,
                createdAt: ctx.now,
                updatedAt: ctx.now,
            },
        ],
    });

    socket = new SocketModule(config.gateway, runtime, events, { paths: config.paths });
    socket.start();
    const url = socket.getStatusSnapshot().url;
    if (!url) throw new Error("Socket did not start.");
    const ws = new WebSocket(`${url}ws`);
    const received: GatewayControlEnvelope[] = [];
    collect(ws, received);
    await waitOpen(ws);
    await waitType(received, GatewayControlMessageType.ServerHello);

    send(ws, GatewayControlMessageType.EventSubscribe, { types: Object.values(RuntimeEventType) }, "sub-all", "req-sub-all");
    await waitCorrelation(received, "sub-all");

    const liveMessage = message(
        "socket-full-live",
        "自然提起 Flyflor Socket E2E 这个项目，先回忆相关 scope，然后用一句话确认。",
    );
    send(ws, GatewayControlMessageType.GatewayMessageSend, liveMessage, "turn-full-1", "req-turn-full-1");
    await waitType(received, GatewayControlMessageType.TurnFinal, (env) => env.requestId === "req-turn-full-1");

    const queries: Array<[string, string, Record<string, unknown>]> = [
        [GatewayControlMessageType.HistoryList, "history-list-full", { limit: 10 }],
        [GatewayControlMessageType.HistoryDetailGet, "history-detail-full", { eventId: sourceEventId }],
        [GatewayControlMessageType.ScopeList, "scope-list-full", { limit: 10 }],
        [GatewayControlMessageType.ScopeDetailGet, "scope-detail-full", { scopeId: scope.id }],
        [GatewayControlMessageType.ForkList, "fork-list-full", { ownerKey: `scope:${scope.id}`, limit: 10 }],
        [GatewayControlMessageType.ForkDetailGet, "fork-detail-full", { forkId: "fork-full-e2e" }],
        [GatewayControlMessageType.TaskList, "task-list-full", { ownerKey: `scope:${scope.id}`, limit: 10 }],
        [GatewayControlMessageType.TaskDetailGet, "task-detail-full", { taskPlanId: "task-full-e2e" }],
        [GatewayControlMessageType.ReplayList, "replay-list-full", { ownerKey: `scope:${scope.id}`, limit: 10 }],
        [GatewayControlMessageType.ReplayDetailGet, "replay-detail-full", { replayId: "replay-full-e2e" }],
        [GatewayControlMessageType.ThoughtDetailGet, "thought-detail-full", { eventId: sourceEventId }],
        [GatewayControlMessageType.AskList, "ask-list-full", { status: "all", limit: 10 }],
        [GatewayControlMessageType.CrystalList, "crystal-list-full", { limit: 10 }],
    ];
    const queryTypes: string[] = [];
    for (const [type, id, payload] of queries) {
        send(ws, type, payload, id, `req-${id}`);
        const snapshot = await waitSnapshot(received, id);
        queryTypes.push(snapshot.type);
    }

    ws.close();
    const eventTypes = sink.types;
    const scopeRecallEvents = eventTypes.filter((type) => type.startsWith("scope.recall."));
    const failedChecks = [
        ["history snapshot returned", queryTypes.includes(GatewayControlMessageType.HistorySnapshot)],
        ["scope snapshot returned", queryTypes.includes(GatewayControlMessageType.ScopeSnapshot)],
        ["fork snapshot returned", queryTypes.includes(GatewayControlMessageType.ForkSnapshot)],
        ["task snapshot returned", queryTypes.includes(GatewayControlMessageType.TaskSnapshot)],
        ["replay snapshot returned", queryTypes.includes(GatewayControlMessageType.ReplaySnapshot)],
        ["thought snapshot returned", queryTypes.includes(GatewayControlMessageType.ThoughtSnapshot)],
        ["scope recall started", scopeRecallEvents.includes(RuntimeEventType.ScopeRecallStarted)],
        ["scope recall decided", scopeRecallEvents.includes(RuntimeEventType.ScopeRecallDecided)],
    ].filter(([, ok]) => !ok).map(([name]) => String(name));
    report({ ok: failedChecks.length === 0, failedChecks, eventTypes, queryTypes, scopeRecallEvents, tempHome: config.paths.home });
} catch (error) {
    report({ ok: false, failedChecks: [error instanceof Error ? error.message : String(error)], eventTypes: [], queryTypes: [], scopeRecallEvents: [], tempHome: root });
    process.exitCode = 1;
} finally {
    socket?.stop();
    runtime?.dispose();
    await rm(root, { recursive: true, force: true });
}

async function createIsolatedConfig(rootDir: string): Promise<FlyflorConfig> {
    const real = await loadConfig();
    const paths = pathsFor(rootDir);
    const repoRoot = resolve(import.meta.dir, "..");
    await mkdir(dirname(paths.promptDir), { recursive: true });
    await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
    await mkdir(dirname(paths.templateDir), { recursive: true });
    await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
    await mkdir(paths.projectDir, { recursive: true });
    const config = await loadConfigForPaths(paths);
    config.model = real.model;
    config.gateway.host = "127.0.0.1";
    config.gateway.port = await findFreePort();
    config.gateway.stdio = false;
    config.memory.crystal.enabled = false;
    return config;
}

async function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close(() => reject(new Error("Unable to allocate a local TCP port.")));
                return;
            }
            const port = address.port;
            server.close((error) => {
                if (error) reject(error);
                else resolve(port);
            });
        });
    });
}

function pathsFor(rootDir: string): FlyflorPaths {
    const home = join(rootDir, "home");
    const project = join(rootDir, "workspace");
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

function message(id: string, text: string): GatewayMessage {
    return {
        id,
        receivedAt: new Date().toISOString(),
        text,
        attachments: [],
        user: { id: "socket-full-user", displayName: "Socket Full User" },
        route: { channel: Channel.Ws, chatType: ChatType.Direct, conversationKey: "socket-full-e2e" },
    };
}

function projectPathFor(rootDir: string): string {
    return join(rootDir, "workspace");
}

function send(ws: WebSocket, type: string, payload: unknown, id: string, requestId: string): void {
    ws.send(JSON.stringify({ protocol: GatewayControlProtocol.WsV1, id, type, at: new Date().toISOString(), requestId, payload }));
}

function collect(ws: WebSocket, received: GatewayControlEnvelope[]): void {
    ws.onmessage = (event) => received.push(JSON.parse(String(event.data)) as GatewayControlEnvelope);
}

function waitOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("websocket open failed"));
    });
}

async function waitType(
    received: GatewayControlEnvelope[],
    type: string,
    predicate: (env: GatewayControlEnvelope) => boolean = () => true,
): Promise<GatewayControlEnvelope> {
    for (let i = 0; i < 12_000; i += 1) {
        const found = received.find((env) => env.type === type && predicate(env));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}`);
}

function waitCorrelation(received: GatewayControlEnvelope[], correlationId: string): Promise<GatewayControlEnvelope> {
    return waitType(received, GatewayControlMessageType.Ack, (env) => env.correlationId === correlationId);
}

async function waitSnapshot(received: GatewayControlEnvelope[], correlationId: string): Promise<GatewayControlEnvelope> {
    for (let i = 0; i < 12_000; i += 1) {
        const found = received.find((env) => env.correlationId === correlationId && env.type.endsWith(".snapshot"));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting snapshot for ${correlationId}`);
}

function report(value: Report): void {
    console.log(JSON.stringify(value, null, 2));
    if (!value.ok) process.exitCode = 1;
}

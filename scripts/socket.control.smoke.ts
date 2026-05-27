#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SocketModule } from "../src/socket/module.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { createGatewayControlEnvelope, parseGatewayControlEnvelope } from "../src/protocol/control/index.ts";
import type {
    GatewayControlEnvelope,
    GatewayControlGatewayStatusPayload,
    GatewayControlServerHelloPayload,
    GatewayControlTurnFinalPayload,
} from "../src/protocol/control/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
} from "../src/protocol/contracts/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { event, EventsComponent, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";

interface SocketControlSmokeReport {
    approvedCapabilityEvents: string[];
    approvedCapabilityHistoryMetadata: Array<{
        executiveToolExecutions?: SocketControlSmokeReport["approvedCapabilityMetadata"];
        kind?: string;
        messageId?: string;
    }>;
    approvedCapabilityMetadata: Array<{
        capabilityKind?: string;
        key?: string;
        ok?: boolean;
        resultSummary?: string;
    }>;
    capabilityCommands: string[];
    deltaText: string;
    eventTypes: string[];
    eventPublishTypes: string[];
    historyCount: number;
    historyKinds: string[];
    loopSnapshotKind?: string;
    resumedReplyKind?: string;
    finalText: string;
    helloSemanticTypes: string[];
    ok: boolean;
    statusHost: string;
    statusPort: number;
    tempHome: string;
}

class ScriptedStreamingModel implements ModelClient {
    private approvedReadIssued = false;
    private noteReadIssued = false;
    private resumed = false;

    public async generate(messages: ModelMessage[]): Promise<string> {
        const reply = this.next(messages);
        return reply;
    }

    public async *stream(messages: ModelMessage[]): AsyncIterable<string> {
        const reply = this.next(messages);
        yield reply;
    }

    private next(messages: ModelMessage[]): string {
        const transcript = messages.map((message) => message.content).join("\n");
        if (transcript.includes("read approved project note")) {
            if (!this.approvedReadIssued) {
                this.approvedReadIssued = true;
                return '<agent_tool_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"approved.txt"}}]}</agent_tool_calls>';
            }
            return "Approved capability final reply.";
        }
        if (!this.noteReadIssued) {
            this.noteReadIssued = true;
            return '<agent_tool_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"notes.txt"}}]}</agent_tool_calls>';
        }
        if (!this.resumed) {
            this.resumed = true;
            return "Socket control smoke resumed final reply.";
        }
        return "Socket control smoke fallback reply.";
    }
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string }> = [];

    public publish(input: ReturnType<typeof event>): void {
        this.events.push({ type: input.type });
    }
}

async function main(): Promise<void> {
    const harness = new SocketControlSmoke();
    const report = await harness.run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
        process.exitCode = 1;
    }
}

class SocketControlSmoke {
    private readonly sink = new RecordingSink();
    private readonly events = new EventsComponent(this.sink, new RuntimeEventBus());
    private socket: SocketModule | undefined;
    private root = "";
    private runtime: RuntimeModule | undefined;

    public async run(): Promise<SocketControlSmokeReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-socket-control-smoke-"));
        try {
            const config = await this.createConfig();
            const memory = new MemoryModule(config, this.events);
            this.runtime = new RuntimeModule(config, new ScriptedStreamingModel(), this.events, undefined, memory);
            const runtime = this.runtime;
            const socket = new SocketModule(config.gateway, runtime, this.events, { model: config.model, paths: config.paths });
            const originalHandleMessage = runtime.handleMessage.bind(runtime);
            runtime.handleMessage = ((message, context, options = {}) => {
                const clientMessageId =
                    typeof message.metadata?.clientMessageId === "string" ? message.metadata.clientMessageId : message.id;
                return originalHandleMessage(message, context, { ...options, maxToolTurns: clientMessageId === "message-3" ? 2 : 1 });
            }) as typeof runtime.handleMessage;
            this.socket = socket;
            this.socket.start();

            const serverUrl = this.socket.getStatusSnapshot().url;
            if (!serverUrl) {
                throw new Error("Socket did not expose a server url");
            }
            const ws = new WebSocket(`${serverUrl}ws`);
            const received: GatewayControlEnvelope[] = [];
            const stopCollecting = startCollecting(ws, received);
            await waitForOpen(ws);
            const first = await waitForEnvelope(received);
            if (first.type !== GatewayControlMessageType.ServerHello) {
                throw new Error(`Expected server.hello first, got ${first.type}`);
            }

            send(
                ws,
                GatewayControlMessageType.EventSubscribe,
                {
                    classes: ["lifecycle", "ask", "effect"],
                },
                { id: "event-sub-1", requestId: "req-event-sub-1" },
            );
            await waitForType(received, GatewayControlMessageType.Ack);

            send(ws, GatewayControlMessageType.GatewayStatusGet, undefined, { id: "status-1", requestId: "req-status-1" });
            const statusEnvelope = await waitForType(received, GatewayControlMessageType.GatewayStatusSnapshot);

            send(ws, GatewayControlMessageType.CapabilityCatalogGet, undefined, { id: "catalog-1", requestId: "req-catalog-1" });
            const catalogEnvelope = await waitForType(received, GatewayControlMessageType.CapabilityCatalogSnapshot);

            send(
                ws,
                GatewayControlMessageType.GatewayMessageSend,
                {
                    id: "message-1",
                    text: "thin client smoke",
                    conversationKey: "thin-client",
                    user: { id: "smoke-user", displayName: "Smoke User" },
                    context: {
                        activeScope: {
                            id: "scope-thin-client",
                            projectDir: config.paths.projectDir,
                            projectMemoryDir: config.paths.projectMemoryDir,
                            title: "Thin Client Scope",
                        },
                    },
                },
                { id: "turn-1", requestId: "req-turn-1" },
            );
            const finalEnvelope = await waitForType(received, GatewayControlMessageType.TurnFinal);
            const final = finalEnvelope.payload as GatewayControlTurnFinalPayload;
            if (final.reply.metadata?.kind !== "ask") {
                throw new Error(`Expected first turn to pause as ask, got: ${JSON.stringify(final.reply.metadata ?? null)}`);
            }
            const behaviorSnapshotId =
                typeof final.reply.metadata.behaviorSnapshotId === "string"
                    ? final.reply.metadata.behaviorSnapshotId
                    : undefined;

            send(
                ws,
                GatewayControlMessageType.GatewayMessageSend,
                {
                    id: "message-2",
                    text: "已提交执行授权策略",
                    conversationKey: "thin-client",
                    user: { id: "smoke-user", displayName: "Smoke User" },
                    context: {
                        activeScope: {
                            id: "scope-thin-client",
                            projectDir: config.paths.projectDir,
                            projectMemoryDir: config.paths.projectMemoryDir,
                            title: "Thin Client Scope",
                        },
                    },
                    metadata: {
                        ...(behaviorSnapshotId
                            ? { continuation: { mode: "continue", snapshotId: behaviorSnapshotId } }
                            : {}),
                        askAnswer: {
                            answers: [
                                {
                                    questionId: "execution-strategy",
                                    choiceId: "continue-tools",
                                    value: "continue-tools",
                                },
                                {
                                    questionId: "budget-policy",
                                    choiceId: "keep-budget",
                                    value: "keep-budget",
                                },
                                {
                                    questionId: "subagent-policy",
                                    choiceId: "keep-subagents",
                                    value: "keep-subagents",
                                },
                            ],
                        },
                        citizenPermission: {
                            authority: "user",
                            capability: "executive-tool-loop",
                            choices: ["continue-tools", "keep-budget", "keep-subagents"],
                            kind: "execution-policy",
                            source: "socket-control-smoke",
                        },
                    },
                },
                { id: "turn-2", requestId: "req-turn-2" },
            );
            const resumedFinalEnvelope = await waitForType(
                received,
                GatewayControlMessageType.TurnFinal,
                (envelope) => envelope.requestId === "req-turn-2",
            );

            send(
                ws,
                GatewayControlMessageType.GatewayMessageSend,
                {
                    id: "message-3",
                    text: "read approved project note",
                    conversationKey: "thin-client",
                    user: { id: "smoke-user", displayName: "Smoke User" },
                    context: {
                        activeScope: {
                            id: "scope-thin-client",
                            projectDir: config.paths.projectDir,
                            projectMemoryDir: config.paths.projectMemoryDir,
                            title: "Thin Client Scope",
                        },
                    },
                },
                { id: "turn-3", requestId: "req-turn-3" },
            );
            const approvedFinalEnvelope = await waitForType(
                received,
                GatewayControlMessageType.TurnFinal,
                (envelope) => envelope.requestId === "req-turn-3",
            );

            send(
                ws,
                GatewayControlMessageType.HistoryList,
                { limit: 6 },
                { id: "history-1", requestId: "req-history-1" },
            );
            const historyEnvelope = await waitForType(received, GatewayControlMessageType.HistorySnapshot);
            ws.close();
            stopCollecting();

            const hello = first.payload as GatewayControlServerHelloPayload;
            const status = statusEnvelope.payload as GatewayControlGatewayStatusPayload;
            const resumedFinal = resumedFinalEnvelope.payload as GatewayControlTurnFinalPayload;
            const approvedFinal = approvedFinalEnvelope.payload as GatewayControlTurnFinalPayload;
            const capabilityCommands = readCapabilityCommands(catalogEnvelope.payload);
            const firstTurnDelta = received.find(
                (envelope) =>
                    envelope.type === GatewayControlMessageType.TurnDelta &&
                    envelope.requestId === "req-turn-1",
            );
            const deltaText = String(firstTurnDelta?.payload?.delta ?? "");
            const finalText = final.reply.text;
            const history = Array.isArray(historyEnvelope.payload?.history)
                ? historyEnvelope.payload.history as Array<{
                    assistantText?: string;
                    metadata?: Record<string, unknown>;
                    taskPlans?: unknown[];
                    userText?: string;
                }>
                : [];
            const eventTypes = this.sink.events.map((item) => item.type);
            const eventPublishTypes = received
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) => String((envelope.payload as { event?: { type?: string } } | undefined)?.event?.type ?? ""));
            const approvedCapabilityMetadata = readExecutiveToolExecutions(approvedFinal.reply.metadata);
            const approvedCapabilityEvents = received
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) => (envelope.payload as { event?: { payload?: Record<string, unknown>; requestId?: string; type?: string } } | undefined)?.event)
                .filter(
                    (event): event is { type: string; requestId?: string; payload: Record<string, unknown> } =>
                        event?.type === RuntimeEventType.McpToolCallExecuted &&
                        event.requestId === "req-turn-3" &&
                        event.payload?.ok === true &&
                        event.payload?.server === "workspace" &&
                        event.payload?.tool === "read",
                )
                .map((event) => event.type);
            const historyKinds = history
                .map((entry) => {
                    const metadata = readHistoryMetadata(entry.metadata);
                    if (entry.metadata?.ask || String(entry.assistantText ?? "").includes("工具调用预算已用完")) {
                        return "ask";
                    }
                    if (metadata.kind) return metadata.kind;
                    return "unknown";
                });
            const approvedCapabilityHistoryMetadata = history
                .map((entry) => readHistoryMetadata(entry.metadata))
                .filter((metadata) =>
                    metadata.executiveToolExecutions?.some(
                        (execution) =>
                            execution.ok === true &&
                            execution.capabilityKind === "mcp-tool" &&
                            execution.key === "workspace.read" &&
                            String(execution.resultSummary ?? "").includes("approved capability smoke"),
                    ),
                );

            return {
                approvedCapabilityEvents,
                approvedCapabilityHistoryMetadata,
                approvedCapabilityMetadata,
                capabilityCommands,
                deltaText,
                eventTypes,
                eventPublishTypes,
                historyCount: history.length,
                historyKinds,
                loopSnapshotKind: String(final.reply.metadata?.kind ?? ""),
                resumedReplyKind: String(resumedFinal.reply.metadata?.kind ?? ""),
                finalText,
                helloSemanticTypes: hello.capabilities.semanticTypes,
                ok:
                    hello.capabilities.commands.includes(GatewayControlMessageType.GatewayMessageSend) &&
                    hello.capabilities.commands.includes(GatewayControlMessageType.GatewayStatusGet) &&
                    hello.capabilities.commands.includes(GatewayControlMessageType.CapabilityCatalogGet) &&
                    hello.capabilities.semanticTypes.includes("stream") &&
                    status.status.gatewayRunning === true &&
                    capabilityCommands.includes("builtin.gateway") &&
                    finalText.includes("工具调用预算已用完") &&
                    final.reply.metadata?.kind === "ask" &&
                    resumedFinal.reply.metadata?.kind === "reply" &&
                    approvedFinal.reply.text === "Approved capability final reply." &&
                    approvedFinal.reply.metadata?.kind === "reply" &&
                    approvedCapabilityMetadata.some(
                        (execution) =>
                            execution.ok === true &&
                            execution.capabilityKind === "mcp-tool" &&
                            execution.key === "workspace.read" &&
                            String(execution.resultSummary ?? "").includes("approved capability smoke"),
                    ) &&
                    approvedCapabilityEvents.includes(RuntimeEventType.McpToolCallExecuted) &&
                    approvedCapabilityHistoryMetadata.some((metadata) => metadata.kind === "reply") &&
                    history.length >= 3 &&
                    eventTypes.includes(RuntimeEventType.GatewayStart) &&
                    eventTypes.includes(RuntimeEventType.AgentTurnStart) &&
                    eventTypes.includes(RuntimeEventType.AgentTurnEnd) &&
                    eventTypes.includes(RuntimeEventType.ExecutiveLoopPaused) &&
                    eventTypes.includes(RuntimeEventType.ExecutiveLoopResumed) &&
                    eventTypes.includes(RuntimeEventType.McpToolCallExecuted) &&
                    eventPublishTypes.includes(RuntimeEventType.ExecutiveLoopPaused) &&
                    eventPublishTypes.includes(RuntimeEventType.ExecutiveLoopResumed) &&
                    eventPublishTypes.includes(RuntimeEventType.McpToolCallExecuted),
                statusHost: status.status.host,
                statusPort: status.status.port,
                tempHome: config.paths.home,
            };
        } finally {
            this.socket?.stop();
            this.runtime?.dispose();
            await rm(this.root, { recursive: true, force: true });
        }
    }

    private async createConfig(): Promise<FlyflorConfig> {
        const paths = this.paths();
        const repoRoot = resolve(import.meta.dir, "..");
        await mkdir(dirname(paths.promptDir), { recursive: true });
        await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
        await mkdir(dirname(paths.templateDir), { recursive: true });
        await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
        await mkdir(paths.projectDir, { recursive: true });
        await Bun.write(join(paths.projectDir, "notes.txt"), "thin client smoke note\n");
        await Bun.write(join(paths.projectDir, "approved.txt"), "approved capability smoke\n");
        const config = await loadConfigForPaths(paths);
        config.gateway.host = "127.0.0.1";
        config.gateway.port = 0;
        config.gateway.stdio = false;
        return config;
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
}

function send(
    ws: WebSocket,
    type: GatewayControlMessageType,
    payload?: Record<string, unknown>,
    options: { id: string; requestId: string } = { id: crypto.randomUUID(), requestId: crypto.randomUUID() },
): void {
    ws.send(JSON.stringify(createGatewayControlEnvelope(type, payload, options)));
}

function readCapabilityCommands(payload: Record<string, unknown> | undefined): string[] {
    const kits = payload?.kits;
    if (!kits || typeof kits !== "object" || !Array.isArray((kits as { kits?: unknown }).kits)) {
        return [];
    }
    return (kits as { kits: Array<{ id?: string }> }).kits.map((item) => item.id).filter((item): item is string => typeof item === "string");
}

function readExecutiveToolExecutions(metadata: Record<string, unknown> | undefined): SocketControlSmokeReport["approvedCapabilityMetadata"] {
    const executions = metadata?.executiveToolExecutions;
    if (!Array.isArray(executions)) return [];
    return executions
        .filter((execution): execution is Record<string, unknown> => !!execution && typeof execution === "object")
        .map((execution) => ({
            capabilityKind: typeof execution.capabilityKind === "string" ? execution.capabilityKind : undefined,
            key: typeof execution.key === "string" ? execution.key : undefined,
            ok: typeof execution.ok === "boolean" ? execution.ok : undefined,
            resultSummary: typeof execution.resultSummary === "string" ? execution.resultSummary : undefined,
        }));
}

function readHistoryMetadata(metadata: Record<string, unknown> | undefined): SocketControlSmokeReport["approvedCapabilityHistoryMetadata"][number] {
    return {
        executiveToolExecutions: readExecutiveToolExecutions(metadata),
        kind: typeof metadata?.kind === "string" ? metadata.kind : undefined,
        messageId: typeof metadata?.messageId === "string" ? metadata.messageId : undefined,
    };
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket failed to open"));
    });
}

function startCollecting(ws: WebSocket, received: GatewayControlEnvelope[]): () => void {
    const onMessage = (event: MessageEvent<string>) => {
        received.push(JSON.parse(event.data) as GatewayControlEnvelope);
    };
    ws.addEventListener("message", onMessage);
    return () => ws.removeEventListener("message", onMessage);
}

async function waitForEnvelope(
    received: GatewayControlEnvelope[],
    seen = 0,
    label = "next envelope",
): Promise<GatewayControlEnvelope> {
    const deadline = Date.now() + 3_000;
    while (true) {
        if (received.length > seen) {
            return received[seen]!;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}. Received: ${received.map((item) => item.type).join(", ")}`);
        }
        await Bun.sleep(10);
    }
}

async function waitForType(
    received: GatewayControlEnvelope[],
    type: GatewayControlMessageType,
    predicate?: (envelope: GatewayControlEnvelope) => boolean,
): Promise<GatewayControlEnvelope> {
    const existing = received.find((item) => item.type === type && (!predicate || predicate(item)));
    if (existing) {
        return existing;
    }
    let seen = received.length;
    while (true) {
        const next = await waitForEnvelope(received, seen, type);
        seen += 1;
        if (next.type === type && (!predicate || predicate(next))) {
            return next;
        }
    }
}


await main();

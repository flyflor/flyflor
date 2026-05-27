#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SocketModule } from "../src/socket/module.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { createModelClient } from "../src/cognitive/mindstream/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { loadExternalTools } from "../src/executive/external/index.ts";
import {
    loadConfig,
    loadConfigForPaths,
    readModelProviderReadiness,
    type FlyflorConfig,
    type FlyflorPaths,
} from "../src/config/index.ts";
import {
    createGatewayControlEnvelope,
    type GatewayControlEnvelope,
    type GatewayControlEventPublishPayload,
    type GatewayControlHistorySnapshotPayload,
    type GatewayControlTurnFinalPayload,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    RuntimeEventClass,
    SandboxMode,
    type GatewayMessage,
} from "../src/protocol/contracts/index.ts";
import { EventsComponent, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";

interface LiveClosureReport {
    askAnswerPairs: number;
    brainEventCount: number;
    eventPublishTypes: string[];
    eventTypes: string[];
    executionJobCount: number;
    externalTools: Array<{
        effective?: string;
        name: string;
        reason?: string;
        sidecarId?: string;
    }>;
    failedChecks: string[];
    finalKinds: Record<string, string>;
    historyCount: number;
    ok: boolean;
    phantomPermissionUserEvents: number;
    tempHome: string;
    toolExecutionKeys: string[];
}

async function main(): Promise<void> {
    const report = await new LiveLoopClosureScenario().run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
}

class LiveLoopClosureScenario {
    private root = "";
    private runtime: RuntimeModule | undefined;
    private socket: SocketModule | undefined;
    private providerConfig: FlyflorConfig | undefined;

    public async run(): Promise<LiveClosureReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-live-loop-closure-"));
        try {
            const config = await this.createIsolatedConfig();
            const readiness = readModelProviderReadiness(this.providerConfig ?? config);
            if (!readiness.ready) {
                throw new Error(`Configured live provider is not ready: ${JSON.stringify({
                    configDir: readiness.configDir,
                    detail: readiness.detail,
                    model: readiness.model,
                    providerId: readiness.providerId,
                    state: readiness.state,
                })}`);
            }

            const sink = new RecordingSink();
            const events = new EventsComponent(sink, new RuntimeEventBus());
            const memory = new MemoryModule(config, events);
            this.runtime = new RuntimeModule(config, createModelClient(config.model), events, undefined, memory);
            const originalHandleMessage = this.runtime.handleMessage.bind(this.runtime);
            this.runtime.handleMessage = ((message, context, options = {}) => {
                const clientMessageId =
                    typeof message.metadata?.clientMessageId === "string" ? message.metadata.clientMessageId : message.id;
                return originalHandleMessage(message, context, {
                    ...options,
                    maxToolTurns: maxToolTurnsForMessage(clientMessageId),
                });
            }) as typeof this.runtime.handleMessage;

            this.socket = new SocketModule(config.gateway, this.runtime, events, { model: config.model, paths: config.paths });
            this.socket.start();
            const url = this.socket.getStatusSnapshot().url;
            if (!url) throw new Error("Socket did not expose a server url");

            const ws = new WebSocket(`${url}ws`);
            const received: GatewayControlEnvelope[] = [];
            const stopCollecting = startCollecting(ws, received);
            await waitForOpen(ws);
            await waitForType(received, GatewayControlMessageType.ServerHello);
            await this.subscribe(ws, received);

            const baseline = await this.sendTurn(ws, received, config, {
                id: "live-baseline",
                text: "Reply with exactly: live baseline ok",
            });
            const tool = await this.sendTurn(ws, received, config, {
                id: "live-tools",
                text: [
                    "Use local tools before answering.",
                    "Read live-note.txt.",
                    "Write live-output.txt with exactly flyflor-live-tool-ok.",
                    "Run process.run to read live-output.txt.",
                    "Check git status.",
                    "Then answer in one short sentence.",
                ].join(" "),
                approveTools: true,
                yolo: true,
            });
            const ask = await this.sendTurn(ws, received, config, {
                id: "live-budget-ask",
                text: [
                    "Use local tools one at a time before answering.",
                    "First read live-note.txt.",
                    "After that tool result, write budget-output.txt with flyflor-budget-ok.",
                    "Do not answer until both tool steps are done.",
                ].join(" "),
                approveTools: true,
                yolo: true,
            });
            const deniedResume = await this.sendTurn(ws, received, config, {
                id: "live-budget-denied-resume",
                text: "This is ordinary text while the ASK is pending.",
                approveTools: true,
                yolo: true,
            });
            const resumed = await this.sendTurn(ws, received, config, {
                id: "live-budget-resume",
                text: "Submitted execution permission policy.",
                approveTools: true,
                metadata: citizenPermissionMetadata(ask.reply.metadata?.behaviorSnapshotId),
                yolo: true,
            });
            const subagent = await this.sendTurn(ws, received, config, {
                id: "live-subagent",
                text: [
                    "Use subagent.batch to run two focused helper tasks before answering.",
                    "Task one should inspect live-note.txt.",
                    "Task two should inspect package.json.",
                    "Return a concise parent summary after the helpers finish.",
                ].join(" "),
                approveTools: true,
                yolo: true,
            });

            send(ws, GatewayControlMessageType.HistoryList, { limit: 20 }, {
                id: "history-live-closure",
                requestId: "req-history-live-closure",
            });
            const historyEnvelope = await waitForType(
                received,
                GatewayControlMessageType.HistorySnapshot,
                (envelope) => envelope.requestId === "req-history-live-closure",
            );
            send(ws, GatewayControlMessageType.ExecutionJobList, { limit: 20 }, {
                id: "jobs-live-closure",
                requestId: "req-jobs-live-closure",
            });
            await waitForType(
                received,
                GatewayControlMessageType.ExecutionJobSnapshot,
                (envelope) => envelope.requestId === "req-jobs-live-closure",
            );
            ws.close();
            stopCollecting();

            const eventPublishTypes = received
                .filter((envelope) => envelope.type === GatewayControlMessageType.EventPublish)
                .map((envelope) => String(((envelope.payload as GatewayControlEventPublishPayload | undefined)?.event as { type?: string } | undefined)?.type ?? ""));
            const history = historyEnvelope.payload as GatewayControlHistorySnapshotPayload;
            const brain = inspectBrain(config);
            const externalTools = (await loadExternalTools(config.paths)).map((tool) => ({
                effective: tool.stability.effective,
                name: tool.tool.descriptor.name,
                reason: tool.unavailableReason,
                sidecarId: tool.stability.sidecarId,
            }));
            const finalKinds = {
                ask: String(ask.reply.metadata?.kind ?? ""),
                baseline: String(baseline.reply.metadata?.kind ?? ""),
                deniedResume: String(deniedResume.reply.metadata?.kind ?? ""),
                resumed: String(resumed.reply.metadata?.kind ?? ""),
                subagent: String(subagent.reply.metadata?.kind ?? ""),
                tool: String(tool.reply.metadata?.kind ?? ""),
            };
            const toolExecutionKeys = [
                ...executionKeys(tool.reply.metadata),
                ...executionKeys(resumed.reply.metadata),
                ...executionKeys(subagent.reply.metadata),
            ];
            const failedChecks = collectFailedChecks({
                brain,
                eventPublishTypes,
                eventTypes: sink.types,
                externalTools,
                finalKinds,
                historyCount: history.history.length,
                toolExecutionKeys,
            });

            return {
                askAnswerPairs: brain.askAnswerPairs,
                brainEventCount: brain.brainEventCount,
                eventPublishTypes,
                eventTypes: sink.types,
                executionJobCount: brain.executionJobCount,
                externalTools,
                failedChecks,
                finalKinds,
                historyCount: history.history.length,
                ok: failedChecks.length === 0,
                phantomPermissionUserEvents: brain.phantomPermissionUserEvents,
                tempHome: config.paths.home,
                toolExecutionKeys,
            };
        } finally {
            this.socket?.stop();
            this.runtime?.dispose();
            await rm(this.root, { recursive: true, force: true });
        }
    }

    private async subscribe(ws: WebSocket, received: GatewayControlEnvelope[]): Promise<void> {
        send(ws, GatewayControlMessageType.EventSubscribe, {
            classes: [RuntimeEventClass.Ask, RuntimeEventClass.Control, RuntimeEventClass.Effect, RuntimeEventClass.Lifecycle],
        }, { id: "event-subscribe-live-closure", requestId: "req-event-subscribe-live-closure" });
        await waitForType(received, GatewayControlMessageType.Ack, (envelope) =>
            envelope.correlationId === "event-subscribe-live-closure"
        );
    }

    private async sendTurn(
        ws: WebSocket,
        received: GatewayControlEnvelope[],
        config: FlyflorConfig,
        input: { approveTools?: boolean; id: string; metadata?: Record<string, unknown>; text: string; yolo?: boolean },
    ): Promise<GatewayControlTurnFinalPayload> {
        const requestId = `req-${input.id}`;
        send(ws, GatewayControlMessageType.GatewayMessageSend, {
            id: input.id,
            text: input.text,
            conversationKey: "live-loop-closure",
            user: { id: "live-loop-user", displayName: "Live Loop User" },
            context: {
                activeScope: {
                    id: "scope-live-loop",
                    projectDir: config.paths.projectDir,
                    projectMemoryDir: config.paths.projectMemoryDir,
                    title: "Live Loop Closure",
                },
                toolApprovals: input.approveTools ? { mcpToolCalls: true, userToolCalls: true } : undefined,
            },
            metadata: {
                ...(input.metadata ?? {}),
                ...(input.yolo ? { permissions: { mode: SandboxMode.Yolo } } : {}),
            },
        }, { id: `turn-${input.id}`, requestId });
        const envelope = await waitForType(
            received,
            GatewayControlMessageType.TurnFinal,
            (candidate) => candidate.requestId === requestId,
        );
        return envelope.payload as GatewayControlTurnFinalPayload;
    }

    private async createIsolatedConfig(): Promise<FlyflorConfig> {
        const providerConfig = await loadConfig();
        this.providerConfig = providerConfig;
        const paths = this.paths();
        const repoRoot = resolve(import.meta.dir, "..");
        await mkdir(dirname(paths.promptDir), { recursive: true });
        await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
        await mkdir(dirname(paths.templateDir), { recursive: true });
        await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
        await mkdir(paths.projectDir, { recursive: true });
        await writeFile(join(paths.projectDir, "live-note.txt"), "flyflor live closure note\n");
        await writeFile(join(paths.projectDir, "package.json"), JSON.stringify({ name: "flyflor-live-closure" }, null, 2));
        await run(["git", "init"], paths.projectDir);
        await run(["git", "add", "."], paths.projectDir);
        await run(["git", "commit", "-m", "seed"], paths.projectDir, true);

        const config = await loadConfigForPaths(paths);
        config.model = providerConfig.model;
        config.gateway.host = "127.0.0.1";
        config.gateway.port = 0;
        config.gateway.stdio = false;
        return config;
    }

    private paths(): FlyflorPaths {
        const home = join(this.root, "home");
        const project = join(this.root, "workspace");
        const repoRoot = resolve(import.meta.dir, "..");
        return {
            appRoot: repoRoot,
            home,
            configDir: home,
            storageDir: join(home, "storage"),
            cacheDir: join(home, "cache"),
            workspaceDir: project,
            logDir: join(home, "logs"),
            memoryDir: join(project, ".flyflor", "memory"),
            projectDir: project,
            projectFlyflorDir: join(project, ".flyflor"),
            projectKitDir: join(project, ".flyflor", "kits"),
            projectMemoryDir: join(project, ".flyflor", "memory"),
            projectMcpDir: join(project, ".flyflor", "mcp"),
            projectPluginDir: join(project, ".flyflor", "plugins"),
            projectSkillDir: join(project, ".flyflor", "skills"),
            projectToolDir: join(repoRoot, "tools"),
            pluginDir: join(home, "plugins"),
            promptDir: join(home, "prompts"),
            skillDir: join(home, "skills"),
            templateDir: join(home, "templates"),
            mcpDir: join(home, "mcp"),
            toolDir: join(repoRoot, "tools"),
        };
    }
}

class RecordingSink implements EventSink {
    private readonly events: Array<{ type: string }> = [];

    public publish(event: Parameters<EventSink["publish"]>[0]): void {
        this.events.push({ type: event.type });
    }

    public get types(): string[] {
        return this.events.map((event) => event.type);
    }
}

function maxToolTurnsForMessage(clientMessageId: string): number {
    if (clientMessageId === "live-budget-ask") return 1;
    if (clientMessageId === "live-budget-denied-resume") return 1;
    if (clientMessageId === "live-budget-resume") return 4;
    if (clientMessageId === "live-subagent") return 5;
    if (clientMessageId === "live-tools") return 5;
    return 2;
}

function citizenPermissionMetadata(snapshotId: unknown): Record<string, unknown> {
    return {
        ...(typeof snapshotId === "string" ? { continuation: { mode: "continue", snapshotId } } : {}),
        askAnswer: {
            answers: [
                { questionId: "execution-strategy", choiceId: "continue-tools", value: "continue-tools" },
                { questionId: "budget-policy", choiceId: "keep-budget", value: "keep-budget" },
                { questionId: "subagent-policy", choiceId: "keep-subagents", value: "keep-subagents" },
            ],
        },
        citizenPermission: {
            authority: "user",
            capability: "executive-tool-loop",
            choices: ["continue-tools", "keep-budget", "keep-subagents"],
            kind: "execution-policy",
            source: "live-loop-closure",
        },
    };
}

function inspectBrain(config: FlyflorConfig): {
    askAnswerPairs: number;
    brainEventCount: number;
    executionJobCount: number;
    phantomPermissionUserEvents: number;
} {
    const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
    try {
        const rows = db.query("select type, content from memory_events").all() as Array<{ content: string; type: string }>;
        return {
            askAnswerPairs: rows.filter((row) => row.type === "ask-answer-pair").length,
            brainEventCount: rows.length,
            executionJobCount: rows.filter((row) => row.type === "execution-job").length,
            phantomPermissionUserEvents: rows.filter((row) => {
                if (row.type === "ask-answer-pair") return false;
                try {
                    const parsed = JSON.parse(row.content) as { userText?: unknown };
                    return typeof parsed.userText === "string" &&
                        parsed.userText.includes("continue-tools") &&
                        parsed.userText.includes("keep-budget") &&
                        parsed.userText.includes("keep-subagents");
                } catch {
                    return false;
                }
            }).length,
        };
    } finally {
        db.close();
    }
}

function executionKeys(metadata: Record<string, unknown> | undefined): string[] {
    const executions = metadata?.executiveToolExecutions;
    if (!Array.isArray(executions)) return [];
    return executions
        .map((execution) => execution && typeof execution === "object" ? (execution as { key?: unknown }).key : undefined)
        .filter((key): key is string => typeof key === "string");
}

function collectFailedChecks(input: {
    brain: ReturnType<typeof inspectBrain>;
    eventPublishTypes: string[];
    eventTypes: string[];
    externalTools: LiveClosureReport["externalTools"];
    finalKinds: Record<string, string>;
    historyCount: number;
    toolExecutionKeys: string[];
}): string[] {
    const externalWithSidecar = input.externalTools.filter((tool) => tool.sidecarId);
    const externalByName = new Map(input.externalTools.map((tool) => [tool.name, tool]));
    const available = (name: string) => externalByName.get(name)?.effective === "available";
    const unavailable = (name: string) => externalByName.get(name)?.effective === "unavailable";
    const checks: Array<[string, boolean]> = [
        ["baseline reply completed", input.finalKinds.baseline === "reply"],
        ["tool turn completed", input.finalKinds.tool === "reply"],
        ["budget turn paused as ASK", input.finalKinds.ask === "ask"],
        ["plain pending ASK input did not resume", input.finalKinds.deniedResume === "ask"],
        ["structured citizen permission resumed", input.finalKinds.resumed === "reply"],
        ["subagent scenario completed or paused visibly", input.finalKinds.subagent === "reply" || input.finalKinds.subagent === "ask"],
        ["history replay returned turns", input.historyCount >= 3],
        ["brain ledger has events", input.brain.brainEventCount > 0],
        ["brain ledger has ask answer pair", input.brain.askAnswerPairs >= 1],
        ["brain ledger has execution job events", input.brain.executionJobCount >= 1],
        ["no phantom permission user message", input.brain.phantomPermissionUserEvents === 0],
        ["tool executions include workspace read", input.toolExecutionKeys.includes("workspace.read")],
        ["tool executions include process run", input.toolExecutionKeys.includes("process.run")],
        ["events include executive loop paused", input.eventTypes.includes(RuntimeEventType.ExecutiveLoopPaused)],
        ["events include executive loop resumed", input.eventTypes.includes(RuntimeEventType.ExecutiveLoopResumed)],
        ["events include process lifecycle", input.eventTypes.includes(RuntimeEventType.ProcessStart) && input.eventTypes.includes(RuntimeEventType.ProcessExit)],
        ["socket published executive pause", input.eventPublishTypes.includes(RuntimeEventType.ExecutiveLoopPaused)],
        ["socket published executive resume", input.eventPublishTypes.includes(RuntimeEventType.ExecutiveLoopResumed)],
        ["external tool descriptors are visible", input.externalTools.length >= 10],
        ["real sidecar descriptors are configured when installed", externalWithSidecar.length > 0],
        ["browser live probe surface is read-only/open only", available("browser.open") && available("browser.snapshot") && available("browser.screenshot")],
        ["browser control tools are not exposed by default", unavailable("browser.click") && unavailable("browser.type") && unavailable("browser.navigate") && unavailable("browser.evaluate") && unavailable("browser.use")],
        ["computer native live probe surface is read-only only", available("screen.screenshot") && available("computer.window")],
        ["computer control tools are not exposed by default", unavailable("computer.mouse") && unavailable("computer.keyboard") && unavailable("computer.use")],
        ["providerless search/media/lsp/task tools are unavailable", unavailable("web.search") && unavailable("vision.ocr") && unavailable("audio.speak") && unavailable("lsp.symbols") && unavailable("task.background")],
        ["local utility tools stay available", available("file.hash") && available("archive.create") && available("archive.extract") && available("data.convert")],
    ];
    return checks.filter(([, ok]) => !ok).map(([name]) => name);
}

function send(
    ws: WebSocket,
    type: GatewayControlMessageType,
    payload?: Record<string, unknown>,
    options: { id: string; requestId: string } = { id: crypto.randomUUID(), requestId: crypto.randomUUID() },
): void {
    ws.send(JSON.stringify(createGatewayControlEnvelope(type, payload, options)));
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
    const deadline = Date.now() + 180_000;
    while (true) {
        const existing = received.find((item) => item.type === type && (!predicate || predicate(item)));
        if (existing) return existing;
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${type}. Received: ${received.map((item) => item.type).join(", ")}`);
        }
        await Bun.sleep(25);
    }
}

async function run(command: string[], cwd: string, allowFailure = false): Promise<void> {
    const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (code !== 0 && !allowFailure) {
        throw new Error(`${command.join(" ")} failed: ${stdout}${stderr}`);
    }
}

await main();

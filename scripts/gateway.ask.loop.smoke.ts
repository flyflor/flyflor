#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { GatewayModule } from "../src/agent/gateway/module.ts";
import { createGatewayControlEnvelope, parseGatewayControlEnvelope } from "../src/protocol/control/index.ts";
import type { GatewayControlEnvelope, GatewayControlTurnFinalPayload } from "../src/protocol/control/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    AskReason,
    GatewayControlMessageType,
    MemoryEventType,
    ModelRole,
    type ModelClient,
    type ModelMessage,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { event, EventsComponent, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { Database } from "bun:sqlite";

interface GatewayAskLoopSmokeReport {
    finalTexts: string[];
    historyEventTypes: string[];
    loopEventTypes: string[];
    ok: boolean;
    tempHome: string;
}

class SequencedStreamingModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];
    private index = 0;

    public constructor(private readonly responses: string[]) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        const response = this.responses[this.index];
        this.index += 1;
        if (response === undefined) {
            throw new Error("SequencedStreamingModel response exhausted.");
        }
        return response;
    }

    public async *stream(messages: ModelMessage[]): AsyncIterable<string> {
        yield await this.generate(messages);
    }
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string }> = [];

    public publish(input: ReturnType<typeof event>): void {
        this.events.push({ type: input.type });
    }
}

async function main(): Promise<void> {
    const harness = new GatewayAskLoopSmoke();
    const report = await harness.run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
}

class GatewayAskLoopSmoke {
    private readonly sink = new RecordingSink();
    private readonly events = new EventsComponent(this.sink, new RuntimeEventBus());
    private gateway: GatewayModule | undefined;
    private root = "";
    private config: FlyflorConfig | undefined;

    public async run(): Promise<GatewayAskLoopSmokeReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-gateway-ask-loop-smoke-"));
        try {
            this.config = await this.createConfig();
            const memory = new MemoryModule(this.config, this.events);
            await memory.warmup();
            const dispatch = new GatewayAskLoopDispatch(memory, this.events);
            this.gateway = new GatewayModule(
                this.config.gateway,
                {
                    warmup: async () => undefined,
                    dispose: () => undefined,
                    listChatHistory: (options?: { beforeTs?: number; limit?: number }) => memory.listChatHistory(options),
                    handleMessage: (message: GatewayMessage, context: RuntimeContext) => dispatch.handleMessage(message, context),
                } as unknown as { handleMessage: (message: GatewayMessage, context: RuntimeContext) => Promise<GatewayReply> },
                this.events,
                { paths: this.config.paths },
            );
            this.gateway.start();

            const serverUrl = this.gateway.getStatusSnapshot().url;
            if (!serverUrl) throw new Error("Gateway did not expose a server url");
            const ws = new WebSocket(`${serverUrl}ws`);
            const received: GatewayControlEnvelope[] = [];
            ws.addEventListener("message", (event) => {
                received.push(readEnvelope(event.data as string));
            });
            await waitForOpen(ws);
            await waitForType(received, GatewayControlMessageType.ServerHello);

            send(
                ws,
                GatewayControlMessageType.EventSubscribe,
                { types: [RuntimeEventType.ExecutiveLoopPaused, RuntimeEventType.ExecutiveLoopResumed] },
                { id: "sub-1", requestId: "req-sub-1" },
            );
            await waitForType(received, GatewayControlMessageType.Ack);

            send(
                ws,
                GatewayControlMessageType.GatewayMessageSend,
                {
                    id: "loop-message-1",
                    text: "inspect with small budget",
                    conversationKey: "ask-loop",
                    context: askLoopContext(this.config.paths.projectDir),
                    user: { id: "smoke-user", displayName: "Smoke User" },
                },
                { id: "turn-1", requestId: "req-turn-1" },
            );
            const firstFinalEnvelope = await waitForType(received, GatewayControlMessageType.TurnFinal);
            const firstFinal = firstFinalEnvelope.payload as GatewayControlTurnFinalPayload;
            const sinkEventTypesAfterFirstTurn = this.sink.events.map((item) => item.type);
            if (firstFinal.reply.metadata?.kind !== "ask" || !sinkEventTypesAfterFirstTurn.includes(RuntimeEventType.ExecutiveLoopPaused)) {
                throw new Error(
                    JSON.stringify({
                        reason: "first-turn-not-paused-ask",
                        firstFinal: firstFinal.reply.metadata,
                        sinkEventTypesAfterFirstTurn,
                    }),
                );
            }
            await waitForRuntimeEvent(received, RuntimeEventType.ExecutiveLoopPaused);

            send(
                ws,
                GatewayControlMessageType.GatewayMessageSend,
                {
                    id: "loop-message-2",
                    text: "继续",
                    conversationKey: "ask-loop",
                    context: askLoopContext(this.config.paths.projectDir),
                    user: { id: "smoke-user", displayName: "Smoke User" },
                },
                { id: "turn-2", requestId: "req-turn-2" },
            );
            const secondFinalEnvelope = await waitForType(received, GatewayControlMessageType.TurnFinal, firstFinalEnvelope.id);
            await waitForRuntimeEvent(received, RuntimeEventType.ExecutiveLoopResumed);
            ws.close();

            const secondFinal = secondFinalEnvelope.payload as GatewayControlTurnFinalPayload;
            const historyEventTypes = this.readHistoryEventTypes();
            const loopEventTypes = this.sink.events
                .map((item) => item.type)
                .filter(
                    (type) =>
                        type === RuntimeEventType.ExecutiveLoopPaused ||
                        type === RuntimeEventType.ExecutiveLoopResumed ||
                        type === RuntimeEventType.MemoryAskAnswered ||
                        type === RuntimeEventType.MemoryAskRecorded,
                );

            return {
                finalTexts: [firstFinal.reply.text, secondFinal.reply.text],
                historyEventTypes,
                loopEventTypes,
                ok:
                    firstFinal.reply.metadata?.kind === "ask" &&
                    secondFinal.reply.text.includes("Follow-through complete.") &&
                    secondFinal.reply.metadata?.kind === "reply" &&
                    historyEventTypes.includes(MemoryEventType.Ask) &&
                    historyEventTypes.includes(MemoryEventType.AskAnswerPair) &&
                    loopEventTypes.includes(RuntimeEventType.ExecutiveLoopPaused) &&
                    loopEventTypes.includes(RuntimeEventType.ExecutiveLoopResumed),
                tempHome: this.config.paths.home,
            };
        } finally {
            this.gateway?.stop();
            await this.events.flush();
            await rm(this.root, { recursive: true, force: true });
        }
    }

    private readHistoryEventTypes(): string[] {
        if (!this.config) return [];
        const db = new Database(join(this.config.paths.configDir, "brain.db"), { readonly: true });
        try {
            return (db
                .query<{ type: string }, []>("SELECT type FROM memory_events ORDER BY ts ASC")
                .all() as Array<{ type: string }>).map((row) => row.type);
        } finally {
            db.close();
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
        await Bun.write(join(paths.projectDir, "todo.txt"), "follow-through todo\n");
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

class GatewayAskLoopDispatch {
    private pendingContinuation = false;

    public constructor(private readonly memory: MemoryModule, private readonly events: EventsComponent) {}

    public async handleMessage(message: GatewayMessage, context: RuntimeContext): Promise<GatewayReply> {
        this.events.publish(event(RuntimeEventType.AgentTurnStart, {}, context.requestId));
        if (!this.pendingContinuation) {
            this.pendingContinuation = true;
            const ask = {
                reason: AskReason.Other,
                prompt: "工具预算已到上限，请确认是否继续。",
                freeform: true,
            };
            const reply: GatewayReply = {
                messageId: message.id,
                route: message.route,
                text: ask.prompt,
                metadata: {
                    kind: "ask",
                    ask: {
                        ...ask,
                        choiceCount: 0,
                        choices: [],
                        freeform: true,
                        questionCount: 0,
                        questions: [],
                        snapshotId: `behavior-${context.requestId}`,
                    },
                },
            };
            await this.memory.rememberTurn(
                message,
                reply,
                context,
                [],
                { behaviorSnapshotId: `behavior-${context.requestId}` },
                ask,
            );
            this.events.publish(
                event(
                    RuntimeEventType.ExecutiveLoopPaused,
                    {
                        askId: `ask-${context.requestId}`,
                        stepCount: 1,
                        toolBudgetExhausted: true,
                    },
                    context.requestId,
                ),
            );
            this.events.publish(event(RuntimeEventType.AgentTurnEnd, {}, context.requestId));
            return reply;
        }

        const reply: GatewayReply = {
            messageId: message.id,
            route: message.route,
            text: "Follow-through complete.",
            metadata: {
                kind: "reply",
            },
        };
        await this.memory.rememberTurn(message, reply, context);
        this.events.publish(
            event(
                RuntimeEventType.ExecutiveLoopResumed,
                {
                    askId: `ask-${context.requestId}`,
                },
                context.requestId,
            ),
        );
        this.events.publish(event(RuntimeEventType.AgentTurnEnd, {}, context.requestId));
        return reply;
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

function askLoopContext(projectDir: string): Record<string, unknown> {
    return {
        activeScope: {
            id: "scope-ask-loop",
            projectDir,
            projectMemoryDir: join(projectDir, ".flyflor", "memory"),
            title: "Ask Loop Scope",
        },
    };
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket failed to open"));
    });
}

function waitForEnvelope(ws: WebSocket, received: GatewayControlEnvelope[]): Promise<GatewayControlEnvelope> {
    return new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent<string>) => {
            const envelope = readEnvelope(event.data);
            received.push(envelope);
            ws.removeEventListener("message", onMessage);
            resolve(envelope);
        };
        const onError = () => {
            ws.removeEventListener("message", onMessage);
            reject(new Error("WebSocket receive failed"));
        };
        ws.addEventListener("message", onMessage);
        ws.addEventListener("error", onError, { once: true });
    });
}

function readEnvelope(raw: string): GatewayControlEnvelope {
    try {
        return parseGatewayControlEnvelope(raw);
    } catch {
        return JSON.parse(raw) as GatewayControlEnvelope;
    }
}

async function waitForType(
    received: GatewayControlEnvelope[],
    type: GatewayControlMessageType,
    excludeId?: string,
): Promise<GatewayControlEnvelope> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const existing = received.find((item) => item.type === type && item.id !== excludeId);
        if (existing) return existing;
        await sleep(25);
    }
    throw new Error(`Timed out waiting for ${type}`);
}

async function waitForRuntimeEvent(
    received: GatewayControlEnvelope[],
    eventType: string,
): Promise<GatewayControlEnvelope> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const existing = received.find(
            (item) =>
                item.type === GatewayControlMessageType.EventPublish &&
                (item.payload as { event?: { type?: string } } | undefined)?.event?.type === eventType,
        );
        if (existing) return existing;
        await sleep(25);
    }
    throw new Error(`Timed out waiting for runtime event ${eventType}`);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();

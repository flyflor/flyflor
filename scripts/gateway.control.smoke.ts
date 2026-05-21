#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { GatewayModule } from "../src/agent/gateway/module.ts";
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
import { event, RuntimeEventType, type EventSink } from "../src/events/index.ts";

interface GatewayControlSmokeReport {
    capabilityCommands: string[];
    deltaText: string;
    eventTypes: string[];
    finalText: string;
    helloSemanticTypes: string[];
    ok: boolean;
    statusHost: string;
    statusPort: number;
    tempHome: string;
}

class ScriptedStreamingModel implements ModelClient {
    public async generate(messages: ModelMessage[]): Promise<string> {
        const text = messages.at(-1)?.content ?? "";
        return `Gateway control smoke final reply for: ${text}`;
    }

    public async *stream(messages: ModelMessage[]): AsyncIterable<string> {
        const text = messages.at(-1)?.content ?? "";
        yield "Gateway control smoke ";
        yield `final reply for: ${text}`;
    }
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string }> = [];

    public publish(input: ReturnType<typeof event>): void {
        this.events.push({ type: input.type });
    }
}

async function main(): Promise<void> {
    const harness = new GatewayControlSmoke();
    const report = await harness.run();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
        process.exitCode = 1;
    }
}

class GatewayControlSmoke {
    private readonly events = new RecordingSink();
    private gateway: GatewayModule | undefined;
    private root = "";
    private runtime: RuntimeModule | undefined;

    public async run(): Promise<GatewayControlSmokeReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-gateway-control-smoke-"));
        try {
            const config = await this.createConfig();
            const memory = new MemoryModule(config, this.events);
            this.runtime = new RuntimeModule(config, new ScriptedStreamingModel(), this.events, undefined, memory);
            this.gateway = new GatewayModule(config.gateway, this.runtime, this.events, { paths: config.paths });
            this.gateway.start();

            const serverUrl = this.gateway.getStatusSnapshot().url;
            if (!serverUrl) {
                throw new Error("Gateway did not expose a server url");
            }
            const ws = new WebSocket(`${serverUrl}ws`);
            const received: GatewayControlEnvelope[] = [];
            await waitForOpen(ws);
            const first = await waitForEnvelope(ws, received);
            if (first.type !== GatewayControlMessageType.ServerHello) {
                throw new Error(`Expected server.hello first, got ${first.type}`);
            }

            send(ws, GatewayControlMessageType.GatewayStatusGet, undefined, { id: "status-1", requestId: "req-status-1" });
            const statusEnvelope = await waitForType(ws, received, GatewayControlMessageType.GatewayStatusSnapshot);

            send(ws, GatewayControlMessageType.CapabilityCatalogGet, undefined, { id: "catalog-1", requestId: "req-catalog-1" });
            const catalogEnvelope = await waitForType(ws, received, GatewayControlMessageType.CapabilityCatalogSnapshot);

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
                            projectDir: join(config.paths.projectDir, "scope-thin-client"),
                            projectMemoryDir: join(config.paths.projectDir, "scope-thin-client", ".flyflor", "memory"),
                            title: "Thin Client Scope",
                        },
                    },
                },
                { id: "turn-1", requestId: "req-turn-1" },
            );
            const deltaEnvelope = await waitForType(ws, received, GatewayControlMessageType.TurnDelta);
            const finalEnvelope = await waitForType(ws, received, GatewayControlMessageType.TurnFinal);
            ws.close();

            const hello = first.payload as GatewayControlServerHelloPayload;
            const status = statusEnvelope.payload as GatewayControlGatewayStatusPayload;
            const final = finalEnvelope.payload as GatewayControlTurnFinalPayload;
            const capabilityCommands = readCapabilityCommands(catalogEnvelope.payload);
            const deltaText = String(deltaEnvelope.payload?.delta ?? "");
            const finalText = final.reply.text;
            const eventTypes = this.events.events.map((item) => item.type);

            return {
                capabilityCommands,
                deltaText,
                eventTypes,
                finalText,
                helloSemanticTypes: hello.capabilities.semanticTypes,
                ok:
                    hello.capabilities.commands.includes(GatewayControlMessageType.GatewayMessageSend) &&
                    hello.capabilities.commands.includes(GatewayControlMessageType.GatewayStatusGet) &&
                    hello.capabilities.commands.includes(GatewayControlMessageType.CapabilityCatalogGet) &&
                    hello.capabilities.semanticTypes.includes("stream") &&
                    status.status.gatewayRunning === true &&
                    capabilityCommands.includes("builtin.gateway") &&
                    deltaText.length > 0 &&
                    finalText.includes("thin client smoke") &&
                    eventTypes.includes(RuntimeEventType.GatewayStart) &&
                    eventTypes.includes(RuntimeEventType.AgentTurnStart) &&
                    eventTypes.includes(RuntimeEventType.AgentTurnEnd),
                statusHost: status.status.host,
                statusPort: status.status.port,
                tempHome: config.paths.home,
            };
        } finally {
            this.gateway?.stop();
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

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket failed to open"));
    });
}

function waitForEnvelope(ws: WebSocket, received: GatewayControlEnvelope[]): Promise<GatewayControlEnvelope> {
    return new Promise((resolve, reject) => {
        const onMessage = (event: MessageEvent<string>) => {
            const envelope = parseGatewayControlEnvelope(event.data);
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

async function waitForType(
    ws: WebSocket,
    received: GatewayControlEnvelope[],
    type: GatewayControlMessageType,
): Promise<GatewayControlEnvelope> {
    const existing = received.find((item) => item.type === type);
    if (existing) {
        return existing;
    }
    while (true) {
        const next = await waitForEnvelope(ws, received);
        if (next.type === type) {
            return next;
        }
    }
}

await main();

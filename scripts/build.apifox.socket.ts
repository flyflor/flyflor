#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GatewayControlMessageType, GatewayControlProtocol } from "../src/protocol/contracts/index.ts";

type JsonRecord = Record<string, unknown>;
type JsonSchema = JsonRecord;

interface OpenApiContract {
    components?: {
        examples?: Record<string, { summary?: string; value?: unknown }>;
    };
    info?: JsonRecord;
    openapi?: string;
    paths?: JsonRecord;
    servers?: unknown[];
}

interface FrameExample {
    direction: "client->server" | "server->client";
    expected?: string[];
    folder: string;
    name: string;
    summary: string;
    value: JsonRecord;
}

const repoRoot = join(import.meta.dir, "..");
const sourcePath = join(repoRoot, "docs", "openapi", "flyflor.socket.openapi.json");
const apifoxPath = join(repoRoot, "docs", "apifox", "flyflor.socket.apifox.json");
const apifoxOpenApiPath = join(repoRoot, "docs", "apifox", "flyflor.socket.apifox.openapi.json");
const args = new Set(process.argv.slice(2));
const writeMode = args.has("--write");
const checkMode = args.has("--check");

if (!writeMode && !checkMode) {
    console.error("Usage: bun run scripts/build.apifox.socket.ts --write|--check");
    process.exit(1);
}

const source = JSON.parse(await readFile(sourcePath, "utf8")) as OpenApiContract;
const canonicalExamples = readCanonicalExamples(source);
const examples = { ...canonicalExamples, ...extraExamples() };
const frames = buildFrames(examples);
const apifox = buildApifoxProject(frames, examples);
const apifoxOpenApi = buildApifoxOpenApi(source, frames, examples);
const generatedApifox = `${JSON.stringify(apifox, null, 2)}\n`;
const generatedApifoxOpenApi = `${JSON.stringify(apifoxOpenApi, null, 2)}\n`;

if (writeMode) {
    await mkdir(dirname(apifoxPath), { recursive: true });
    await writeFile(apifoxPath, generatedApifox, "utf8");
    await writeFile(apifoxOpenApiPath, generatedApifoxOpenApi, "utf8");
    console.log(`wrote ${apifoxPath}`);
    console.log(`wrote ${apifoxOpenApiPath}`);
} else {
    await assertGenerated(apifoxPath, generatedApifox);
    await assertGenerated(apifoxOpenApiPath, generatedApifoxOpenApi);
    console.log(`ok ${apifoxPath}`);
    console.log(`ok ${apifoxOpenApiPath}`);
}

function readCanonicalExamples(contract: OpenApiContract): Record<string, JsonRecord> {
    const examples: Record<string, JsonRecord> = {};
    for (const [name, example] of Object.entries(contract.components?.examples ?? {})) {
        if (isRecord(example.value)) {
            examples[name] = example.value;
        }
    }
    return examples;
}

function buildFrames(examples: Record<string, JsonRecord>): FrameExample[] {
    return [
        clientFrame("ClientHello", "00 Handshake", ["Ack"], examples),
        clientFrame("Ping", "00 Handshake", ["Pong"], examples),
        serverFrame("ServerHello", "00 Handshake", examples),
        serverFrame("Ack", "00 Handshake", examples),
        serverFrame("Pong", "00 Handshake", examples),

        clientFrame("GatewayStatusGet", "01 Control", ["GatewayStatusSnapshot"], examples),
        clientFrame("CapabilityCatalogGet", "01 Control", ["CapabilityCatalogSnapshot"], examples),
        serverFrame("GatewayStatusSnapshot", "01 Control", examples),
        serverFrame("CapabilityCatalogSnapshot", "01 Control", examples),

        clientFrame(
            "GatewayMessageSend",
            "02 Live Turn",
            ["TurnDelta", "TurnFinal", "TurnFinalWithAsk", "TurnFinalWithPlanning", "TurnFinalWithExecutiveLoopPause"],
            examples,
        ),
        clientFrame("InvalidGatewayMessageSend", "02 Live Turn", ["InvalidPayloadError"], examples),
        serverFrame("TurnDelta", "02 Live Turn", examples),
        serverFrame("TurnFinal", "02 Live Turn", examples),
        serverFrame("TurnFinalWithAsk", "02 Live Turn", examples),
        serverFrame("TurnFinalWithPlanning", "02 Live Turn", examples),
        serverFrame("TurnFinalWithExecutiveLoopPause", "02 Live Turn", examples),
        serverFrame("TurnError", "02 Live Turn", examples),
        serverFrame("InvalidPayloadError", "02 Live Turn", examples),

        clientFrame("HistoryList", "03 TUI Read Queries", ["HistorySnapshot"], examples),
        clientFrame("HistoryDetailGet", "03 TUI Read Queries", ["HistoryDetailSnapshot"], examples),
        clientFrame("ScopeList", "03 TUI Read Queries", ["ScopeSnapshot"], examples),
        clientFrame("ScopeDetailGet", "03 TUI Read Queries", ["ScopeDetailSnapshot"], examples),
        clientFrame("ForkList", "03 TUI Read Queries", ["ForkListSnapshot"], examples),
        clientFrame("ForkDetailGet", "03 TUI Read Queries", ["ForkSnapshot"], examples),
        clientFrame("AskList", "03 TUI Read Queries", ["AskSnapshot"], examples),
        clientFrame("AskDetailGet", "03 TUI Read Queries", ["AskDetailSnapshot"], examples),
        clientFrame("BlackboardList", "03 TUI Read Queries", ["BlackboardSnapshot"], examples),
        clientFrame("BlackboardDetailGet", "03 TUI Read Queries", ["BlackboardDetailSnapshot"], examples),
        clientFrame("TaskList", "03 TUI Read Queries", ["TaskSnapshot"], examples),
        clientFrame("TaskDetailGet", "03 TUI Read Queries", ["TaskDetailSnapshot"], examples),
        clientFrame("ReplayList", "03 TUI Read Queries", ["ReplaySnapshot"], examples),
        clientFrame("ReplayDetailGet", "03 TUI Read Queries", ["ReplayDetailSnapshot"], examples),
        clientFrame("ThoughtDetailGet", "03 TUI Read Queries", ["ThoughtSnapshot"], examples),
        clientFrame("CrystalList", "03 TUI Read Queries", ["CrystalSnapshot"], examples),

        serverFrame("HistorySnapshot", "04 TUI Snapshots", examples),
        serverFrame("HistoryDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ScopeSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ScopeDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ForkListSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ForkSnapshot", "04 TUI Snapshots", examples),
        serverFrame("AskSnapshot", "04 TUI Snapshots", examples),
        serverFrame("AskDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("BlackboardSnapshot", "04 TUI Snapshots", examples),
        serverFrame("BlackboardDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("TaskSnapshot", "04 TUI Snapshots", examples),
        serverFrame("TaskDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ReplaySnapshot", "04 TUI Snapshots", examples),
        serverFrame("ReplayDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ThoughtSnapshot", "04 TUI Snapshots", examples),
        serverFrame("CrystalSnapshot", "04 TUI Snapshots", examples),

        clientFrame(
            "EventSubscribe",
            "05 Event Stream",
            ["EventPublish", "ExecutiveLoopPausedEvent", "ExecutiveLoopResumedEvent"],
            examples,
        ),
        clientFrame("EventUnsubscribe", "05 Event Stream", [], examples),
        serverFrame("EventPublish", "05 Event Stream", examples),
        serverFrame("ExecutiveLoopPausedEvent", "05 Event Stream", examples),
        serverFrame("ExecutiveLoopResumedEvent", "05 Event Stream", examples),
    ];
}

function buildApifoxProject(frames: FrameExample[], examples: Record<string, JsonRecord>): JsonRecord {
    const folders = Array.from(new Set(frames.map((frame) => frame.folder))).map((folder) => ({
        name: folder,
        type: "folder",
        items: frames
            .filter((frame) => frame.folder === folder)
            .map((frame) => ({
                name: `${frame.direction === "client->server" ? "WS Send" : "WS Expect"} / ${frame.name}`,
                type: "api",
                api: {
                    protocol: "websocket",
                    method: "GET",
                    path: "/ws",
                    url: "{{ws_origin}}/ws",
                    requestBody: {
                        mode: "raw",
                        raw: JSON.stringify(frame.value, null, 2),
                        type: "json",
                    },
                    responseExamples: (frame.expected ?? []).map((name) => ({
                        name,
                        body: examples[name] ?? null,
                        schema: examples[name] ? schemaForEnvelope(examples[name]) : undefined,
                    })),
                    schema: schemaForEnvelope(frame.value),
                },
                extensions: {
                    "x-flyflor-direction": frame.direction,
                    "x-flyflor-example-name": frame.name,
                    "x-flyflor-real-surface": "/ws",
                    "x-flyflor-summary": frame.summary,
                },
            })),
    }));

    return {
        apifoxProject: "1.0.0",
        info: {
            name: "Flyflor WebSocket 测试示例",
            description:
                "Apifox project-style WebSocket example set generated from the canonical /ws OpenAPI examples. Real HTTP surface remains only GET /health and WS /ws.",
            version: source.info?.version ?? "1.0.0",
        },
        source: {
            canonicalOpenApi: "../openapi/flyflor.socket.openapi.json",
            generatedBy: "scripts/build.apifox.socket.ts",
        },
        realSurface: [
            { method: "GET", path: "/health" },
            { method: "WS", path: "/ws" },
        ],
        environmentCollection: [
            {
                name: "Local Socket",
                variables: [
                    { name: "http_origin", value: "http://127.0.0.1:8788" },
                    { name: "ws_origin", value: "ws://127.0.0.1:8788" },
                ],
            },
        ],
        apiCollection: folders,
        examples,
    };
}

function buildApifoxOpenApi(
    contract: OpenApiContract,
    frames: FrameExample[],
    examples: Record<string, JsonRecord>,
): JsonRecord {
    const paths: JsonRecord = {
        "/health": buildHealthPath(examples),
        "/ws": buildWsPath(examples),
    };

    for (const frame of frames) {
        const path = `/__apifox/ws/${frame.direction === "client->server" ? "send" : "expect"}/${kebab(frame.name)}`;
        paths[path] = {
            post: {
                tags: [frame.folder],
                summary: `${frame.direction === "client->server" ? "WS send" : "WS expected"}: ${frame.name}`,
                description:
                    "Apifox-only doc operation. Do not call this path on Flyflor. Connect to ws://127.0.0.1:8788/ws and send or compare the raw JSON body.",
                operationId: `apifox${frame.direction === "client->server" ? "Send" : "Expect"}${frame.name}`,
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                $ref: `#/components/schemas/${frame.name}Frame`,
                            },
                            examples: {
                                [frame.name]: {
                                    value: frame.value,
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description: "Doc-only expected WebSocket frame examples.",
                        content: {
                            "application/json": {
                                schema: responseSchemaForFrame(frame, examples),
                                examples: Object.fromEntries(
                                    (frame.expected ?? [frame.name])
                                        .filter((name) => examples[name])
                                        .map((name) => [name, { value: examples[name] }]),
                                ),
                            },
                        },
                    },
                },
                "x-apifox-folder": frame.folder,
                "x-flyflor-doc-only": true,
                "x-flyflor-real-ws-url": "ws://127.0.0.1:8788/ws",
                "x-flyflor-direction": frame.direction,
            },
        };
    }

    return {
        openapi: "3.0.3",
        info: {
            title: "Flyflor WebSocket 测试示例",
            version: contract.info?.version ?? "1.0.0",
            description:
                "Apifox 专用 WebSocket frame 测试展开视图。真实服务契约仍是 docs/openapi/flyflor.socket.openapi.json，并且只暴露 /health 与 /ws。",
        },
        servers: normalizeServers(contract.servers),
        tags: Array.from(new Set(frames.map((frame) => frame.folder))).map((name) => ({ name })),
        paths,
        components: {
            examples: Object.fromEntries(Object.entries(examples).map(([name, value]) => [name, { value }])),
            schemas: Object.fromEntries(
                Object.entries(examples).map(([name, value]) => [`${name}Frame`, schemaForEnvelope(value)]),
            ),
        },
        "x-flyflor-canonical-openapi": "../openapi/flyflor.socket.openapi.json",
        "x-flyflor-real-surface": ["/health", "/ws"],
    };
}

function buildHealthPath(examples: Record<string, JsonRecord>): JsonRecord {
    return {
        get: {
            tags: ["00 服务入口"],
            summary: "健康检查",
            description: "真实服务入口：GET /health。",
            operationId: "getSocketHealth",
            responses: {
                "200": {
                    description: "服务存活。",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["ok"],
                                properties: {
                                    ok: { type: "boolean" },
                                },
                                additionalProperties: false,
                            },
                            examples: {
                                HealthOk: {
                                    value: examples.HealthOk ?? { ok: true },
                                },
                            },
                        },
                    },
                },
            },
            "x-apifox-folder": "00 服务入口",
        },
    };
}

function buildWsPath(examples: Record<string, JsonRecord>): JsonRecord {
    return {
        get: {
            tags: ["00 服务入口"],
            summary: "WebSocket 连接入口",
            description: "真实服务入口：连接 ws://127.0.0.1:8788/ws，然后发送本集合里的 raw JSON frame。",
            operationId: "connectSocketWebSocket",
            responses: {
                "101": {
                    description: "Switching Protocols。连接后服务端发送 server.hello。",
                },
                "400": errorResponse("升级失败", examples.SocketUpgradeFailed),
                "401": errorResponse("未授权", examples.Unauthorized),
                "503": errorResponse("服务未就绪", examples.SocketNotReady),
            },
            "x-apifox-folder": "00 服务入口",
        },
    };
}

function errorResponse(description: string, example: JsonRecord | undefined): JsonRecord {
    return {
        description,
        content: {
            "application/json": {
                schema: {
                    type: "object",
                    required: ["error"],
                    properties: {
                        error: { type: "string" },
                    },
                    additionalProperties: false,
                },
                examples: example ? { error: { value: example } } : undefined,
            },
        },
    };
}

function responseSchemaForFrame(frame: FrameExample, examples: Record<string, JsonRecord>): JsonSchema {
    const refs = (frame.expected ?? [frame.name])
        .filter((name) => examples[name])
        .map((name) => ({ $ref: `#/components/schemas/${name}Frame` }));
    if (refs.length === 0) {
        return {
            type: "object",
            additionalProperties: true,
        };
    }
    if (refs.length === 1) return refs[0] ?? {};
    return { oneOf: refs };
}

function normalizeServers(servers: unknown[] | undefined): Array<{ url: string; description?: string }> {
    if (!Array.isArray(servers)) {
        return [{ url: "http://127.0.0.1:8788", description: "本地 Flyflor socket 服务" }];
    }
    return servers
        .filter(isRecord)
        .map((server) => ({
            url: typeof server.url === "string" ? server.url : "http://127.0.0.1:8788",
            description: typeof server.description === "string" ? server.description : undefined,
        }));
}

function schemaForEnvelope(value: JsonRecord): JsonSchema {
    const properties: JsonRecord = {};
    const required: string[] = [];
    for (const [key, item] of Object.entries(value)) {
        required.push(key);
        if ((key === "protocol" || key === "type") && typeof item === "string") {
            properties[key] = { type: "string", enum: [item] };
        } else if (key === "at" && typeof item === "string") {
            properties[key] = { type: "string", format: "date-time" };
        } else {
            properties[key] = schemaForJson(item, 0);
        }
    }
    return {
        type: "object",
        required,
        properties,
        additionalProperties: false,
    };
}

function schemaForJson(value: unknown, depth: number): JsonSchema {
    if (value === null) return { type: "null" };
    if (Array.isArray(value)) {
        const first = value.find((item) => item !== null);
        return {
            type: "array",
            items: first === undefined || depth > 6 ? {} : schemaForJson(first, depth + 1),
        };
    }
    if (typeof value === "object") {
        if (depth > 6) return { type: "object", additionalProperties: true };
        const record = value as JsonRecord;
        return {
            type: "object",
            required: Object.keys(record),
            properties: Object.fromEntries(
                Object.entries(record).map(([key, item]) => [key, schemaForJson(item, depth + 1)]),
            ),
            additionalProperties: true,
        };
    }
    if (typeof value === "string") return { type: "string" };
    if (typeof value === "number") return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
    if (typeof value === "boolean") return { type: "boolean" };
    return {};
}

function clientFrame(
    name: string,
    folder: string,
    expected: string[],
    examples: Record<string, JsonRecord>,
): FrameExample {
    return frame(name, folder, "client->server", expected, examples);
}

function serverFrame(name: string, folder: string, examples: Record<string, JsonRecord>): FrameExample {
    return frame(name, folder, "server->client", undefined, examples);
}

function frame(
    name: string,
    folder: string,
    direction: FrameExample["direction"],
    expected: string[] | undefined,
    examples: Record<string, JsonRecord>,
): FrameExample {
    const value = examples[name];
    if (!value) {
        throw new Error(`Missing Apifox example: ${name}`);
    }
    return {
        direction,
        expected,
        folder,
        name,
        summary: readSummary(value),
        value,
    };
}

function readSummary(value: JsonRecord): string {
    const type = typeof value.type === "string" ? value.type : "http";
    return `${type} example`;
}

function extraExamples(): Record<string, JsonRecord> {
    return {
        AskDetailGet: ws("env-ask-detail-1", GatewayControlMessageType.AskDetailGet, "req-ask-detail-1", {
            askId: "ask-1",
        }),
        AskDetailSnapshot: ws(
            "env-ask-detail-snapshot-1",
            GatewayControlMessageType.AskSnapshot,
            "req-ask-detail-1",
            {
                data: {
                    status: "active",
                    ask: {
                        reason: "other",
                        prompt: "Need confirmation?",
                        freeform: true,
                    },
                    event: {
                        id: "ask-1",
                        type: "ask",
                    },
                },
            },
            "env-ask-detail-1",
        ),
        BlackboardDetailGet: ws(
            "env-blackboard-detail-1",
            GatewayControlMessageType.BlackboardDetailGet,
            "req-blackboard-detail-1",
            {
                blackboardTurnId: "bb-1",
            },
        ),
        BlackboardSnapshot: ws(
            "env-blackboard-snapshot-1",
            GatewayControlMessageType.BlackboardSnapshot,
            "req-blackboard-list-1",
            {
                data: [
                    {
                        id: "bb-1",
                        scopeId: "scope-1",
                        status: "converged",
                        summary: "Socket read-model query plan converged.",
                        steps: [{ id: "bb-step-1", title: "Inspect history", status: "done" }],
                        messages: [{ role: "assistant", content: "Blackboard summary for TUI expansion." }],
                    },
                ],
            },
            "env-blackboard-list-1",
        ),
        BlackboardDetailSnapshot: ws(
            "env-blackboard-detail-snapshot-1",
            GatewayControlMessageType.BlackboardSnapshot,
            "req-blackboard-detail-1",
            {
                data: {
                    turn: {
                        id: "bb-1",
                        scopeId: "scope-1",
                        status: "converged",
                        summary: "Socket read-model query plan converged.",
                        steps: [{ id: "bb-step-1", title: "Inspect history", status: "done" }],
                        decisions: [{ id: "bb-decision-1", title: "Keep query read-only", status: "accepted" }],
                    },
                    asks: [],
                    forks: [],
                    replays: [],
                    taskPlans: [],
                },
            },
            "env-blackboard-detail-1",
        ),
        CrystalSnapshot: ws(
            "env-crystal-snapshot-1",
            GatewayControlMessageType.CrystalSnapshot,
            "req-crystal-list-1",
            {
                data: [
                    {
                        id: "gem-1",
                        bucket: "method",
                        title: "Socket read model boundary",
                        summary: "Query commands read persisted DB state and do not invoke runtime thinking.",
                        confidence: 0.92,
                    },
                ],
            },
            "env-crystal-list-1",
        ),
        ForkList: ws("env-fork-list-1", GatewayControlMessageType.ForkList, "req-fork-list-1", {
            scopeId: "scope-1",
            limit: 20,
        }),
        ForkListSnapshot: ws(
            "env-fork-list-snapshot-1",
            GatewayControlMessageType.ForkSnapshot,
            "req-fork-list-1",
            {
                data: [
                    {
                        id: "fork-1",
                        title: "Replay fork",
                        continuitySummary: "Keep socket control context visible.",
                        status: "active",
                    },
                ],
            },
            "env-fork-list-1",
        ),
        HistoryDetailGet: ws(
            "env-history-detail-1",
            GatewayControlMessageType.HistoryDetailGet,
            "req-history-detail-1",
            {
                eventId: "event-1",
            },
        ),
        HistoryDetailSnapshot: ws(
            "env-history-detail-snapshot-1",
            GatewayControlMessageType.HistorySnapshot,
            "req-history-detail-1",
            {
                data: {
                    turn: {
                        eventId: "event-1",
                        ts: 1770000000000,
                        userText: "继续推进 socket 血管层",
                        assistantText: "我会按 Scope 和当前上下文继续推进。",
                    },
                    event: {
                        id: "event-1",
                        type: "event",
                        ownerKey: "scope:scope-1",
                    },
                    asks: [],
                    taskPlans: [],
                    replays: [],
                    thoughtAvailable: true,
                },
            },
            "env-history-detail-1",
        ),
        ReplayDetailGet: ws("env-replay-detail-1", GatewayControlMessageType.ReplayDetailGet, "req-replay-detail-1", {
            replayId: "replay-1",
        }),
        ReplaySnapshot: ws(
            "env-replay-snapshot-1",
            GatewayControlMessageType.ReplaySnapshot,
            "req-replay-list-1",
            {
                data: [
                    {
                        id: "replay-1",
                        kind: "blackboard",
                        title: "Replay",
                        summary: "Replay summary",
                        taskPlanId: "task-plan-1",
                        contextForkId: "fork-1",
                        blackboardTurnId: "bb-1",
                    },
                ],
            },
            "env-replay-list-1",
        ),
        ReplayDetailSnapshot: ws(
            "env-replay-detail-snapshot-1",
            GatewayControlMessageType.ReplaySnapshot,
            "req-replay-detail-1",
            {
                data: {
                    replay: {
                        id: "replay-1",
                        kind: "blackboard",
                        title: "Replay",
                        summary: "Replay summary",
                    },
                    sourceEvent: {
                        id: "event-1",
                        type: "event",
                    },
                    asks: [],
                    forks: [],
                },
            },
            "env-replay-detail-1",
        ),
        ScopeDetailGet: ws("env-scope-detail-1", GatewayControlMessageType.ScopeDetailGet, "req-scope-detail-1", {
            scopeId: "scope-1",
        }),
        ScopeDetailSnapshot: ws(
            "env-scope-detail-snapshot-1",
            GatewayControlMessageType.ScopeSnapshot,
            "req-scope-detail-1",
            {
                data: {
                    scope: {
                        id: "scope-1",
                        title: "Flyflor core",
                        projectDir: "/workspace/project",
                        projectMemoryDir: "/workspace/project/.flyflor/memory",
                    },
                    indexCounts: {
                        vectors: 1,
                        treeNodes: 4,
                        hotMemory: 8,
                        associations: 20,
                    },
                    treeNodes: [{ id: "tree-1", title: "Socket vascular layer", depth: 0, score: 0.9 }],
                    hotMemory: [
                        { id: "hot-1", summary: "TUI needs expandable read-model snapshots.", importance: 0.88 },
                    ],
                    associations: [{ id: "assoc-1", term: "TUI", kind: "scope-keyword", weight: 0.91 }],
                    forks: [],
                    asks: [],
                    taskPlans: [],
                    replays: [],
                    recentTurns: [],
                },
            },
            "env-scope-detail-1",
        ),
        TaskDetailGet: ws("env-task-detail-1", GatewayControlMessageType.TaskDetailGet, "req-task-detail-1", {
            taskPlanId: "task-plan-1",
        }),
        TaskSnapshot: ws(
            "env-task-snapshot-1",
            GatewayControlMessageType.TaskSnapshot,
            "req-task-list-1",
            {
                data: [
                    {
                        id: "task-plan-1",
                        title: "Socket closure",
                        status: "in-progress",
                        progress: 0.5,
                        stepCount: 2,
                        completedStepCount: 1,
                    },
                ],
            },
            "env-task-list-1",
        ),
        TaskDetailSnapshot: ws(
            "env-task-detail-snapshot-1",
            GatewayControlMessageType.TaskSnapshot,
            "req-task-detail-1",
            {
                data: {
                    taskPlan: {
                        id: "task-plan-1",
                        title: "Socket closure",
                        status: "in-progress",
                        steps: [
                            { id: "step-1", title: "Refresh Apifox examples", status: "done" },
                            { id: "step-2", title: "Run drift guards", status: "in-progress" },
                        ],
                    },
                    asks: [],
                    forks: [],
                    replays: [],
                },
            },
            "env-task-detail-1",
        ),
        ThoughtSnapshot: ws(
            "env-thought-snapshot-1",
            GatewayControlMessageType.ThoughtSnapshot,
            "req-thought-detail-1",
            {
                data: {
                    event: {
                        id: "event-1",
                        type: "event",
                    },
                    summary: {
                        hiddenChainOfThought: false,
                        content: {
                            summary: "Deep-think detail is represented as a safe summary for TUI expansion.",
                        },
                    },
                    forks: [],
                    replays: [],
                    taskPlans: [],
                },
            },
            "env-thought-detail-1",
        ),
    };
}

function ws(id: string, type: string, requestId: string, payload: unknown, correlationId?: string): JsonRecord {
    return {
        protocol: GatewayControlProtocol.WsV1,
        id,
        type,
        at: "2026-05-22T00:00:05.900Z",
        requestId,
        ...(correlationId ? { correlationId } : {}),
        payload,
    };
}

function kebab(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

async function assertGenerated(path: string, expected: string): Promise<void> {
    const current = await readFile(path, "utf8");
    if (current !== expected) {
        console.error(`Apifox artifact drift: ${path}`);
        process.exit(1);
    }
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

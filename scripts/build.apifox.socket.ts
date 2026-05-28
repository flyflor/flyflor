#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GatewayControlMessageType, GatewayControlProtocol } from "../src/protocol/contracts/index.ts";

type JsonRecord = Record<string, unknown>;
type JsonSchema = JsonRecord;

interface OpenApiContract {
    components?: {
        examples?: Record<string, { value?: unknown }>;
        schemas?: Record<string, JsonSchema>;
    };
    info?: JsonRecord;
    paths?: JsonRecord;
    servers?: unknown[];
}

interface FrameExample {
    direction: "client->server" | "server->client";
    expected?: string[];
    folder: string;
    name: string;
    value: JsonRecord;
}

const repoRoot = join(import.meta.dir, "..");
const sourcePath = join(repoRoot, "docs", "openapi", "flyflor.socket.openapi.json");
const messageCatalogPath = join(repoRoot, "docs", "apifox", "flyflor.socket.messages.json");
const apifoxOpenApiPath = join(repoRoot, "docs", "apifox", "flyflor.socket.apifox.openapi.json");
const testerPath = join(repoRoot, "docs", "apifox", "flyflor.socket.tester.html");
const args = new Set(process.argv.slice(2));
const writeMode = args.has("--write");
const checkMode = args.has("--check");

if (!writeMode && !checkMode) {
    console.error("Usage: bun run scripts/build.apifox.socket.ts --write|--check");
    process.exit(1);
}

const source = JSON.parse(await readFile(sourcePath, "utf8")) as OpenApiContract;
const examples = { ...readCanonicalExamples(source), ...extraExamples() };
const frames = buildFrames(examples);
const catalog = buildMessageCatalog(frames, examples);
const apifoxOpenApi = buildRealOpenApi(source, catalog);
const tester = buildTesterHtml(catalog);

const generatedCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
const generatedOpenApi = `${JSON.stringify(apifoxOpenApi, null, 2)}\n`;
const generatedTester = `${tester.trimEnd()}\n`;

if (writeMode) {
    await mkdir(dirname(messageCatalogPath), { recursive: true });
    await writeFile(messageCatalogPath, generatedCatalog, "utf8");
    await writeFile(apifoxOpenApiPath, generatedOpenApi, "utf8");
    await writeFile(testerPath, generatedTester, "utf8");
    console.log(`wrote ${messageCatalogPath}`);
    console.log(`wrote ${apifoxOpenApiPath}`);
    console.log(`wrote ${testerPath}`);
} else {
    await assertGenerated(messageCatalogPath, generatedCatalog);
    await assertGenerated(apifoxOpenApiPath, generatedOpenApi);
    await assertGenerated(testerPath, generatedTester);
    console.log(`ok ${messageCatalogPath}`);
    console.log(`ok ${apifoxOpenApiPath}`);
    console.log(`ok ${testerPath}`);
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
        clientFrame("GatewayMessageInterrupt", "02 Live Turn", ["Ack", "TurnError"], examples),
        clientFrame("GatewayMessageUndo", "02 Live Turn", ["Ack"], examples),
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
        clientFrame("ForkCreate", "03 TUI Read Queries", ["ForkSnapshot"], examples),
        clientFrame("ForkDetailGet", "03 TUI Read Queries", ["ForkSnapshot"], examples),
        clientFrame("AskList", "03 TUI Read Queries", ["AskSnapshot"], examples),
        clientFrame("AskDetailGet", "03 TUI Read Queries", ["AskDetailSnapshot"], examples),
        clientFrame("ConfirmList", "03 TUI Read Queries", ["ConfirmSnapshot"], examples),
        clientFrame("ConfirmDetailGet", "03 TUI Read Queries", ["ConfirmSnapshot"], examples),
        clientFrame("BlackboardList", "03 TUI Read Queries", ["BlackboardSnapshot"], examples),
        clientFrame("BlackboardDetailGet", "03 TUI Read Queries", ["BlackboardDetailSnapshot"], examples),
        clientFrame("TaskList", "03 TUI Read Queries", ["TaskSnapshot"], examples),
        clientFrame("TaskDetailGet", "03 TUI Read Queries", ["TaskDetailSnapshot"], examples),
        clientFrame("TaskPlanDecide", "03 TUI Read Queries", ["TaskSnapshot"], examples),
        clientFrame("ReplayList", "03 TUI Read Queries", ["ReplaySnapshot"], examples),
        clientFrame("ReplayDetailGet", "03 TUI Read Queries", ["ReplayDetailSnapshot"], examples),
        clientFrame("ThoughtDetailGet", "03 TUI Read Queries", ["ThoughtSnapshot"], examples),
        clientFrame("CrystalList", "03 TUI Read Queries", ["CrystalSnapshot"], examples),
        clientFrame("ExecutionJobList", "03 TUI Read Queries", ["ExecutionJobSnapshot"], examples),
        clientFrame("ExecutionJobDetailGet", "03 TUI Read Queries", ["ExecutionJobSnapshot"], examples),

        serverFrame("HistorySnapshot", "04 TUI Snapshots", examples),
        serverFrame("HistoryDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ScopeSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ScopeDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ForkListSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ForkSnapshot", "04 TUI Snapshots", examples),
        serverFrame("AskSnapshot", "04 TUI Snapshots", examples),
        serverFrame("AskDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ConfirmSnapshot", "04 TUI Snapshots", examples),
        serverFrame("BlackboardSnapshot", "04 TUI Snapshots", examples),
        serverFrame("BlackboardDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("TaskSnapshot", "04 TUI Snapshots", examples),
        serverFrame("TaskDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ReplaySnapshot", "04 TUI Snapshots", examples),
        serverFrame("ReplayDetailSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ThoughtSnapshot", "04 TUI Snapshots", examples),
        serverFrame("CrystalSnapshot", "04 TUI Snapshots", examples),
        serverFrame("ExecutionJobSnapshot", "04 TUI Snapshots", examples),

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

function buildMessageCatalog(frames: FrameExample[], examples: Record<string, JsonRecord>): JsonRecord {
    const messages = frames.map((frame) => ({
        direction: frame.direction,
        expected: frame.expected ?? [],
        folder: frame.folder,
        name: frame.name,
        schema: schemaForEnvelope(frame.value),
        type: frame.value.type,
        value: frame.value,
    }));
    return {
        name: "Flyflor WebSocket Message Catalog",
        version: source.info?.version ?? "1.0.0",
        realEndpoint: {
            health: "http://127.0.0.1:8788/health",
            websocket: "ws://127.0.0.1:8788/ws",
        },
        usage: [
            "运行 `bun run socket` 启动 Flyflor。",
            "在 Apifox 或浏览器客户端创建真实 WebSocket 请求：ws://127.0.0.1:8788/ws。",
            "把本目录 client->server message 的 value 作为 raw JSON WebSocket 消息发送。",
            "不要创建辅助 HTTP 发送接口；Flyflor 的真实服务面只有 /health 和 /ws。",
        ],
        groups: Array.from(new Set(frames.map((frame) => frame.folder))).map((folder) => ({
            name: folder,
            messages: messages.filter((message) => message.folder === folder).map((message) => message.name),
        })),
        messages,
        examples,
    };
}

function buildRealOpenApi(contract: OpenApiContract, catalog: JsonRecord): JsonRecord {
    return {
        openapi: "3.0.3",
        info: {
            title: "Flyflor 真实 WebSocket 接口",
            version: contract.info?.version ?? "1.0.0",
            description:
                "给前端联调用的真实 Flyflor HTTP/WebSocket 服务面。真实路径只有 /health 和 /ws；WebSocket 消息示例在 flyflor.socket.messages.json。",
        },
        servers: normalizeServers(contract.servers),
        paths: {
            "/health": buildHealthPath(),
            "/ws": buildWsPath(catalog, contract),
        },
        components: {
            schemas: {
                HealthResponse: {
                    type: "object",
                    required: ["ok"],
                    properties: { ok: { type: "boolean" } },
                    additionalProperties: false,
                },
                WebSocketClientMessage:
                    contract.components?.schemas?.["ClientToServerEnvelope"] ?? schemaForCatalogMessages(catalog, "client->server"),
                WebSocketServerMessage:
                    contract.components?.schemas?.["ServerToClientEnvelope"] ?? schemaForCatalogMessages(catalog, "server->client"),
            },
        },
        "x-flyflor-message-catalog": "flyflor.socket.messages.json",
        "x-flyflor-real-surface": ["/health", "/ws"],
    };
}

function buildHealthPath(): JsonRecord {
    return {
        get: {
            tags: ["真实服务面"],
            summary: "健康检查",
            description: "真实 HTTP endpoint。它不触发 runtime thinking 或 context assembly。",
            operationId: "getHealth",
            responses: {
                "200": {
                    description: "Socket process is alive.",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["ok"],
                                properties: { ok: { type: "boolean" } },
                                additionalProperties: false,
                            },
                            example: { ok: true },
                        },
                    },
                },
            },
        },
    };
}

function buildWsPath(catalog: JsonRecord, contract: OpenApiContract): JsonRecord {
    const sendMessages = Array.isArray(catalog.messages)
        ? catalog.messages.filter((message): message is JsonRecord => isRecord(message) && message.direction === "client->server")
        : [];
    const serverMessages = Array.isArray(catalog.messages)
        ? catalog.messages.filter((message): message is JsonRecord => isRecord(message) && message.direction === "server->client")
        : [];
    return {
        get: {
            tags: ["真实服务面"],
            summary: "WebSocket 连接入口",
            description:
                "真实 WebSocket endpoint。连接 ws://127.0.0.1:8788/ws，并发送 flyflor.socket.messages.json 里的 raw JSON frame。Apifox 里必须新建 WebSocket 请求，不要用 HTTP 请求模拟。",
            operationId: "connectWebSocket",
            responses: {
                "101": {
                    description: "Switching Protocols. The server sends server.hello immediately after upgrade.",
                },
                "400": readWsResponse(contract, "400"),
                "401": readWsResponse(contract, "401"),
                "503": readWsResponse(contract, "503"),
            },
            "x-flyflor-websocket-url": "ws://127.0.0.1:8788/ws",
            "x-flyflor-client-message-examples": Object.fromEntries(
                sendMessages.map((message) => [String(message.name), message.value]),
            ),
            "x-flyflor-server-message-examples": Object.fromEntries(
                serverMessages.map((message) => [String(message.name), message.value]),
            ),
        },
    };
}

function schemaForCatalogMessages(catalog: JsonRecord, direction: string): JsonSchema {
    const messages = Array.isArray(catalog.messages)
        ? catalog.messages.filter((message): message is JsonRecord => isRecord(message) && message.direction === direction)
        : [];
    return {
        oneOf: messages
            .map((message) => message.schema)
            .filter((schema): schema is JsonSchema => isRecord(schema)),
    };
}

function readWsResponse(contract: OpenApiContract, status: string): unknown {
    const wsPath = contract.paths?.["/ws"];
    if (!isRecord(wsPath)) return undefined;
    const get = wsPath.get;
    if (!isRecord(get) || !isRecord(get.responses)) return undefined;
    return get.responses[status];
}

function buildTesterHtml(catalog: JsonRecord): string {
    const embeddedCatalog = JSON.stringify(catalog);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Flyflor WebSocket Tester</title>
  <style>
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f7fb; }
    header { padding: 16px 20px; background: #fff; border-bottom: 1px solid #dfe3ea; }
    main { display: grid; grid-template-columns: 280px 1fr; gap: 16px; padding: 16px; }
    button, select, input, textarea { font: inherit; }
    button { border: 1px solid #b8c0cc; background: #fff; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    button.primary { color: #fff; background: #6750e8; border-color: #6750e8; }
    aside, section { background: #fff; border: 1px solid #dfe3ea; border-radius: 8px; }
    aside { padding: 12px; }
    section { padding: 14px; }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
    input { flex: 1; border: 1px solid #c9d0dc; border-radius: 6px; padding: 8px; }
    select { width: 100%; border: 1px solid #c9d0dc; border-radius: 6px; padding: 8px; margin-bottom: 10px; }
    textarea { width: 100%; min-height: 360px; box-sizing: border-box; border: 1px solid #c9d0dc; border-radius: 6px; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { min-height: 240px; max-height: 420px; overflow: auto; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; }
    .status { font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <strong>Flyflor WebSocket Tester</strong>
    <span>真实连接：ws://127.0.0.1:8788/ws</span>
  </header>
  <main>
    <aside>
      <label>消息示例</label>
      <select id="messageSelect"></select>
      <button id="loadButton">载入示例</button>
    </aside>
    <section>
      <div class="row">
        <input id="urlInput" value="ws://127.0.0.1:8788/ws">
        <button id="connectButton" class="primary">连接</button>
        <button id="closeButton">断开</button>
        <span id="status" class="status">未连接</span>
      </div>
      <textarea id="bodyInput"></textarea>
      <div class="row">
        <button id="sendButton" class="primary">发送 WebSocket 消息</button>
        <button id="clearButton">清空日志</button>
      </div>
      <pre id="log"></pre>
    </section>
  </main>
  <script>
    const catalog = ${embeddedCatalog};
    let socket = null;
    const select = document.querySelector("#messageSelect");
    const body = document.querySelector("#bodyInput");
    const log = document.querySelector("#log");
    const status = document.querySelector("#status");
    const clientMessages = catalog.messages.filter((message) => message.direction === "client->server");
    for (const message of clientMessages) {
      const option = document.createElement("option");
      option.value = message.name;
      option.textContent = message.folder + " / " + message.name;
      select.appendChild(option);
    }
    function append(prefix, value) {
      log.textContent += "[" + new Date().toLocaleTimeString() + "] " + prefix + " " + value + "\\n";
      log.scrollTop = log.scrollHeight;
    }
    function loadSelected() {
      const message = clientMessages.find((item) => item.name === select.value) || clientMessages[0];
      body.value = JSON.stringify(message.value, null, 2);
    }
    document.querySelector("#loadButton").onclick = loadSelected;
    document.querySelector("#connectButton").onclick = () => {
      socket = new WebSocket(document.querySelector("#urlInput").value);
      socket.onopen = () => { status.textContent = "已连接"; append("open", "connected"); };
      socket.onclose = (event) => { status.textContent = "已断开"; append("close", event.code + " " + event.reason); };
      socket.onerror = () => append("error", "websocket error");
      socket.onmessage = (event) => append("recv", event.data);
    };
    document.querySelector("#closeButton").onclick = () => socket && socket.close();
    document.querySelector("#sendButton").onclick = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        append("error", "not connected");
        return;
      }
      socket.send(body.value);
      append("send", body.value);
    };
    document.querySelector("#clearButton").onclick = () => { log.textContent = ""; };
    loadSelected();
  </script>
</body>
</html>`;
}

function normalizeServers(servers: unknown[] | undefined): Array<{ url: string; description?: string }> {
    if (!Array.isArray(servers)) {
        return [{ url: "http://127.0.0.1:8788", description: "Local Flyflor socket service" }];
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
    return { type: "object", required, properties, additionalProperties: false };
}

function schemaForJson(value: unknown, depth: number): JsonSchema {
    if (value === null) return { type: "null" };
    if (Array.isArray(value)) {
        const first = value.find((item) => item !== null);
        return { type: "array", items: first === undefined || depth > 6 ? {} : schemaForJson(first, depth + 1) };
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
        value,
    };
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
        ConfirmDetailGet: ws("env-confirm-detail-1", GatewayControlMessageType.ConfirmDetailGet, "req-confirm-detail-1", {
            confirmId: "confirm-1",
        }),
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

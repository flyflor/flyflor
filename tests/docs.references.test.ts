import { describe, expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    CapabilityExecutionKind,
    ChannelLinkState,
    ChannelTransport,
    ChatType,
    ExecutiveLoopGuardReason,
    GatewayControlMessageType,
    GatewayControlProtocol,
    ReplayRecordKind,
    RuntimeEventClass,
    TaskPlanStatus,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType } from "../src/events/index.ts";
import {
    GatewayControlErrorCode,
    GatewayControlReplyMetadataKind,
    GatewayControlSemanticType,
    parseGatewayControlEnvelope,
    readGatewayControlHistoryListInput,
    readGatewayControlMessageInput,
    readGatewayControlSubscription,
} from "../src/protocol/control/index.ts";

const REPO_ROOT = join(import.meta.dir, "..");

type OpenApiSchema = {
    const?: string;
    enum?: string[];
    items?: OpenApiSchema;
    oneOf?: Array<{ $ref?: string }>;
    properties?: Record<string, OpenApiSchema>;
    required?: string[];
};

describe("documentation references", () => {
    test("referenced test files exist", async () => {
        const docs = ["README.md", ...(await listMarkdownFiles(join(REPO_ROOT, "docs")))];
        const refs: string[] = [];
        for (const doc of docs) {
            const text = await Bun.file(join(REPO_ROOT, doc)).text();
            for (const match of text.matchAll(/tests\/[A-Za-z0-9./-]+\.test\.ts/gu)) {
                refs.push(match[0]);
            }
        }

        const missing: string[] = [];
        for (const ref of Array.from(new Set(refs)).sort()) {
            if (!(await exists(join(REPO_ROOT, ref)))) {
                missing.push(ref);
            }
        }

        expect(missing).toEqual([]);
    });

    test("crystal docs keep runtime Gem gate distinct from graph evidence count", async () => {
        const docs = ["README.md", "docs/crystal.reflection.md", "docs/memory.system.md"];
        const staleClaims: string[] = [];

        for (const doc of docs) {
            const text = await Bun.file(join(REPO_ROOT, doc)).text();
            if (/memory_node\s+confidence\s*>\s*0\.5\s+AND\s+evidenceCount\s*(?:>=|≥)\s*3/iu.test(text)) {
                staleClaims.push(doc);
            }
        }

        expect(staleClaims).toEqual([]);
    });

    test("control protocol docs keep snapshot layers distinct and a single error section", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "control.protocol.md")).text();
        const errorHeadings = doc.match(/^## Error$/gmu) ?? [];

        expect(doc).toContain("## Snapshot Matrix");
        expect(doc).toContain("连接级 snapshot");
        expect(doc).toContain("turn 级 snapshot");
        expect(doc).toContain("事件流");
        expect(errorHeadings).toHaveLength(1);
    });

    test("ws api docs cite the live gateway tests and core message types", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "ws.doc.md")).text();

        expect(doc).toContain("tests/gateway.control.smoke.test.ts");
        expect(doc).toContain("tests/gateway.ws.test.ts");
        expect(doc).toContain("tests/protocol.control.test.ts");
        expect(doc).toContain("tests/gateway.module.test.ts");
        expect(doc).toContain("tests/tui.chat.history.test.ts");
        expect(doc).toContain("server.hello");
        expect(doc).toContain("gateway.status.snapshot");
        expect(doc).toContain("clientCount");
        expect(doc).toContain("capability.catalog.snapshot");
        expect(doc).toContain("turn.final");
        expect(doc).toContain("invalid-envelope");
        expect(doc).toContain("gateway.message.send payload requires text");
        expect(doc).toContain('"classes": ["control"]');
        expect(doc).not.toContain('"classes": ["gateway"]');
        expect(doc).toContain("ws-actor");
        expect(doc).toContain("历史对话列表获取");
        expect(doc).toContain("history.list");
        expect(doc).toContain("history.snapshot");
        expect(doc).toContain("listChatHistory");
        expect(doc).toContain("executive.loop.paused");
        expect(doc).toContain("executive.loop.resumed");
    });

    test("socket OpenAPI contract is Apifox-importable and keeps wire-v1 compatibility examples", async () => {
        const text = await Bun.file(join(REPO_ROOT, "docs", "openapi", "flyflor.socket.openapi.json")).text();
        const contract = JSON.parse(text) as {
            components?: {
                examples?: Record<string, { value?: unknown }>;
                schemas?: Record<string, OpenApiSchema>;
            };
            openapi?: string;
            paths?: Record<string, {
                get?: {
                    responses?: Record<string, {
                        content?: {
                            "application/json"?: {
                                schema?: { $ref?: string };
                            };
                        };
                    }>;
                };
            }>;
        };
        const wireText = JSON.stringify(contract);
        const schemas = contract.components?.schemas ?? {};
        const socketMessageTypes = contract.components?.schemas?.SocketMessageType?.enum ?? [];
        const examples = contract.components?.examples ?? {};
        const clientEnvelopeRefs = contract.components?.schemas?.SocketClientEnvelope?.oneOf?.map((item) => item.$ref) ?? [];
        const scenarioTypes = [
            "ServerHello",
            "ClientHello",
            "Ack",
            "GatewayStatusGet",
            "GatewayStatusSnapshot",
            "CapabilityCatalogGet",
            "CapabilityCatalogSnapshot",
            "HistoryList",
            "HistorySnapshot",
            "GatewayMessageSend",
            "TurnDelta",
            "TurnFinal",
            "TurnFinalWithAsk",
            "TurnFinalWithPlanning",
            "TurnFinalWithExecutiveLoopPause",
            "InvalidGatewayMessageSend",
            "InvalidPayloadError",
        ].map((name) => readExampleType(examples, name));

        expect(contract.openapi).toBe("3.1.0");
        expect(contract.paths).toHaveProperty("/health");
        expect(contract.paths).toHaveProperty("/ws");
        expect(contract.paths).not.toHaveProperty("/channels");
        expect(contract.paths?.["/ws"]?.get?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref).toBe(
            "#/components/schemas/UpgradeFailedResponse",
        );
        expect(contract.paths?.["/ws"]?.get?.responses?.["401"]?.content?.["application/json"]?.schema?.$ref).toBe(
            "#/components/schemas/UnauthorizedResponse",
        );
        expect(contract.paths?.["/ws"]?.get?.responses?.["503"]?.content?.["application/json"]?.schema?.$ref).toBe(
            "#/components/schemas/NotReadyResponse",
        );
        expect(contract.components?.schemas).toHaveProperty("SocketEnvelope");
        expect(contract.components?.schemas).toHaveProperty("SocketEventEnvelope");
        expect(contract.components?.schemas).toHaveProperty("SocketClientEnvelope");
        expect(contract.components?.schemas?.SocketClientEnvelope?.oneOf?.length).toBeGreaterThan(0);
        expect(socketMessageTypes).toEqual(
            Object.values(GatewayControlMessageType).filter((type) => type !== GatewayControlMessageType.EventPublish),
        );
        expect(clientEnvelopeRefs).toEqual([
            "#/components/schemas/ClientHelloEnvelope",
            "#/components/schemas/PingEnvelope",
            "#/components/schemas/GatewayStatusGetEnvelope",
            "#/components/schemas/CapabilityCatalogGetEnvelope",
            "#/components/schemas/HistoryListEnvelope",
            "#/components/schemas/GatewayMessageSendEnvelope",
            "#/components/schemas/EventSubscribeEnvelope",
            "#/components/schemas/EventUnsubscribeEnvelope",
        ]);
        expect(schemas.SocketEnvelope?.properties?.protocol?.const).toBe(GatewayControlProtocol.WsV1);
        expect(schemas.SocketEventEnvelope?.properties?.protocol?.const).toBe(GatewayControlProtocol.EventV1);
        expect(schemas.SocketEventEnvelope?.properties?.type?.const).toBe(GatewayControlMessageType.EventPublish);
        expect(schemas.EventSubscription?.properties?.classes?.items?.enum).toEqual(Object.values(RuntimeEventClass));
        expect(schemas.SurfaceCapabilities?.properties?.semanticTypes?.items?.enum).toEqual(
            Object.values(GatewayControlSemanticType),
        );
        expect(schemas.ChannelStatusSnapshot?.properties?.state?.enum).toEqual(Object.values(ChannelLinkState));
        expect(schemas.ChannelStatusSnapshot?.properties?.transport?.enum).toEqual(Object.values(ChannelTransport));
        expect(schemas.MessageSendPayload?.properties?.chatType?.enum).toEqual(Object.values(ChatType));
        expect(schemas.ErrorPayload?.properties?.code?.enum).toEqual(Object.values(GatewayControlErrorCode));
        expect(schemas.ReplyMetadata?.properties?.kind?.enum).toEqual(Object.values(GatewayControlReplyMetadataKind));
        expect(
            schemas.ReplyMetadata?.properties?.executiveToolExecutions?.items?.properties?.capabilityKind?.enum,
        ).toEqual(Object.values(CapabilityExecutionKind));
        expect(schemas.PlanningMetadata?.properties?.taskPlans?.items?.properties?.status?.enum).toEqual(
            Object.values(TaskPlanStatus),
        );
        expect(
            schemas.PlanningMetadata?.properties?.taskPlans?.items?.properties?.steps?.items?.properties?.status?.enum,
        ).toEqual(Object.values(TaskPlanStatus));
        expect(schemas.PlanningMetadata?.properties?.replays?.items?.properties?.kind?.enum).toEqual(
            Object.values(ReplayRecordKind),
        );
        expect(schemas.ExecutiveToolLoopMetadata?.properties?.loopGuardReason?.enum).toEqual(
            Object.values(ExecutiveLoopGuardReason),
        );
        expect(schemas.UpgradeFailedResponse?.properties?.error?.const).toBe("gateway_control_upgrade_failed");
        expect(schemas.GatewayStatusSnapshot?.required).toContain("clientCount");
        expect(schemas.HistoryListPayload?.properties).not.toHaveProperty("sourceKey");
        expect(schemas.HistoryListPayload?.properties).not.toHaveProperty("scope");
        expect(schemas.RuntimeContextInput?.properties).toHaveProperty("activeScope");
        expect(schemas.RuntimeContextInput?.properties).toHaveProperty("activeProject");
        expect(examples.EventPublish?.value).toMatchObject({ protocol: GatewayControlProtocol.EventV1 });
        expect(wireText).toContain(GatewayControlProtocol.WsV1);
        expect(wireText).toContain(GatewayControlProtocol.EventV1);
        expect(scenarioTypes).toEqual([
            GatewayControlMessageType.ServerHello,
            GatewayControlMessageType.ClientHello,
            GatewayControlMessageType.Ack,
            GatewayControlMessageType.GatewayStatusGet,
            GatewayControlMessageType.GatewayStatusSnapshot,
            GatewayControlMessageType.CapabilityCatalogGet,
            GatewayControlMessageType.CapabilityCatalogSnapshot,
            GatewayControlMessageType.HistoryList,
            GatewayControlMessageType.HistorySnapshot,
            GatewayControlMessageType.GatewayMessageSend,
            GatewayControlMessageType.TurnDelta,
            GatewayControlMessageType.TurnFinal,
            GatewayControlMessageType.TurnFinal,
            GatewayControlMessageType.TurnFinal,
            GatewayControlMessageType.TurnFinal,
            GatewayControlMessageType.GatewayMessageSend,
            GatewayControlMessageType.Error,
        ]);
        expect(readExamplePayload(examples, "ClientHello")).toMatchObject({
            clientId: "apifox-client-1",
            name: "Apifox",
            version: "1.0.0",
        });
        expect(readExamplePayload(examples, "TurnFinalWithPlanning")).toMatchObject({
            reply: {
                metadata: {
                    planning: {
                        taskPlans: [{ status: TaskPlanStatus.InProgress }],
                    },
                },
            },
        });
        expect(readExamplePayload(examples, "TurnFinalWithExecutiveLoopPause")).toMatchObject({
            reply: {
                metadata: {
                    ask: { executiveToolLoop: { stop: "ask" } },
                    executiveToolLoop: { stop: "ask" },
                },
            },
        });
        expect(readExamplePayload(examples, "InvalidPayloadError")).toMatchObject({
            code: GatewayControlErrorCode.InvalidPayload,
            message: "gateway.message.send payload requires text",
        });
        expect(readExampleEventType(examples, "ExecutiveLoopPausedEvent")).toBe(RuntimeEventType.ExecutiveLoopPaused);
        expect(readExampleEventType(examples, "ExecutiveLoopResumedEvent")).toBe(RuntimeEventType.ExecutiveLoopResumed);
        expect(wireText).toContain("executiveToolLoop");
        expect(wireText).toContain("MemoryComponent");
        expect(wireText).toContain("CrystalComponent");
    });

    test("socket OpenAPI examples parse through the runtime control readers", async () => {
        const text = await Bun.file(join(REPO_ROOT, "docs", "openapi", "flyflor.socket.openapi.json")).text();
        const contract = JSON.parse(text) as {
            components?: {
                examples?: Record<string, { value?: unknown }>;
            };
        };
        const examples = contract.components?.examples ?? {};
        const parseableControlExamples = [
            "ClientHello",
            "GatewayStatusGet",
            "CapabilityCatalogGet",
            "HistoryList",
            "GatewayMessageSend",
            "EventSubscribe",
            "EventUnsubscribe",
            "InvalidGatewayMessageSend",
        ];

        for (const name of parseableControlExamples) {
            expect(() => parseGatewayControlEnvelope(JSON.stringify(examples[name]?.value))).not.toThrow();
        }
        expect(() => parseGatewayControlEnvelope(JSON.stringify(examples.EventPublish?.value))).toThrow(
            "Unsupported gateway control protocol",
        );

        expect(readGatewayControlHistoryListInput(readExamplePayloadRecord(examples, "HistoryList"))).toEqual({
            beforeTs: 1770000000000,
            limit: 20,
        });
        expect(readGatewayControlMessageInput(readExamplePayloadRecord(examples, "GatewayMessageSend"))).toMatchObject({
            context: {
                activeScope: {
                    id: "scope-1",
                    projectDir: "/workspace/project",
                    projectMemoryDir: "/workspace/project/.flyflor/memory",
                },
                contextForkId: "fork-1",
                skillNames: ["review"],
            },
            text: "继续推进这个 Scope",
            user: {
                id: "external-actor-1",
            },
        });
        expect(readGatewayControlSubscription(readExamplePayloadRecord(examples, "EventSubscribe"))).toEqual({
            classes: [RuntimeEventClass.Ask, RuntimeEventClass.Read],
            requestId: undefined,
            types: [
                RuntimeEventType.ExecutiveCapabilityCatalogBuilt,
                RuntimeEventType.ExecutiveLoopPaused,
                RuntimeEventType.ExecutiveLoopResumed,
            ],
        });
    });

    test("bilingual Apifox scenario docs cover the real socket flow", async () => {
        const docs = [
            await Bun.file(join(REPO_ROOT, "docs", "openapi", "flyflor.socket.openapi.md")).text(),
            await Bun.file(join(REPO_ROOT, "docs", "openapi", "flyflor.socket.openapi.zh.cn.md")).text(),
        ];

        for (const doc of docs) {
            expect(doc).toContain("GET /health");
            expect(doc).toContain("ws://127.0.0.1:8788/ws");
            expect(doc).toContain("ServerHello");
            expect(doc).toContain("ClientHello");
            expect(doc).toContain("GatewayStatusGet");
            expect(doc).toContain("CapabilityCatalogGet");
            expect(doc).toContain("HistoryList");
            expect(doc).toContain("GatewayMessageSend");
            expect(doc).toContain("TurnDelta");
            expect(doc).toContain("TurnFinal");
            expect(doc).toContain("TurnFinalWithAsk");
            expect(doc).toContain("TurnFinalWithPlanning");
            expect(doc).toContain("TurnFinalWithExecutiveLoopPause");
            expect(doc).toContain("InvalidPayloadError");
            expect(doc).toContain("MemoryComponent");
            expect(doc).toContain("CrystalComponent");
            expect(doc).toContain("brain.db");
            expect(doc).toContain("wire v2");
            expect(doc).toContain("/channels");
        }
    });

    test("runtime events docs keep event timeline separate from turn-final authority", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "runtime.events.md")).text();

        expect(doc).toContain("## Event Matrix");
        expect(doc).toContain("当前轮权威状态仍读 `turn.final.reply.metadata`");
        expect(doc).toContain("结构化快照仍读 `turn.final.reply.metadata.planning`");
        expect(doc).toContain("`RuntimeEvent` 默认是时间线事实流");
    });

    test("archived rust integration guide keeps the ws handoff checklist stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "old-docs", "rust.integration.md")).text();

        expect(doc).toContain("## 最小连接流程");
        expect(doc).toContain("## Snapshot 分层");
        expect(doc).toContain("gateway.message.send");
        expect(doc).toContain("turn.final.reply.metadata.ask");
        expect(doc).toContain("turn.final.reply.metadata.planning");
        expect(doc).toContain("turn.final.reply.metadata.executiveToolLoop");
        expect(doc).toContain("event.publish");
    });

    test("archived rust connection core guide keeps handshake and reconnect contracts stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "old-docs", "rust.connection.core.md")).text();

        expect(doc).toContain("/ws");
        expect(doc).toContain("server.hello");
        expect(doc).toContain("client.hello");
        expect(doc).toContain("gateway.status.get");
        expect(doc).toContain("capability.catalog.get");
        expect(doc).toContain("ping");
        expect(doc).toContain("pong");
        expect(doc).toContain("reconnecting");
        expect(doc).toContain("Snapshot Cache Ownership");
        expect(doc).toContain("连接级状态与 Turn 级状态分层");
    });

    test("archived rust gateway shell backlog keeps the implementation slices stable", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "old-docs", "rust.gateway.shell.backlog.md")).text();

        expect(doc).toContain("## Slice 1: Connection Core");
        expect(doc).toContain("rust.connection.core.md");
        expect(doc).toContain("## Slice 2: Stream Renderer");
        expect(doc).toContain("## Slice 3: Ask Loop");
        expect(doc).toContain("## Slice 4: Planning Panel");
        expect(doc).toContain("## Slice 5: Long-Horizon Loop Recovery");
        expect(doc).toContain("## Slice 6: Event Timeline");
        expect(doc).toContain("## Slice 7: Shell UX");
    });

    test("directory architecture docs cover the live source ownership layers", async () => {
        const doc = await Bun.file(join(REPO_ROOT, "docs", "directory.architecture.md")).text();

        expect(doc).toContain("`src/agent/prompts`");
        expect(doc).toContain("`src/entities`");
        expect(doc).toContain("`src/components`");
        expect(doc).toContain("`src/types`");
        expect(doc).toContain("`src/protocol/control`");
        expect(doc).toContain("`src/socket`");
    });
});

async function listMarkdownFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const path = join(root, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "scripts" || entry.name === "old-docs") {
                    return [];
                }
                return listMarkdownFiles(path);
            }
            if (entry.isFile() && entry.name.endsWith(".md")) {
                return [path.slice(REPO_ROOT.length + 1)];
            }
            return [];
        }),
    );
    return nested.flat();
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function readExampleType(examples: Record<string, { value?: unknown }>, name: string): string | undefined {
    const value = examples[name]?.value;
    return isRecord(value) && typeof value.type === "string" ? value.type : undefined;
}

function readExamplePayload(examples: Record<string, { value?: unknown }>, name: string): unknown {
    const value = examples[name]?.value;
    return isRecord(value) ? value.payload : undefined;
}

function readExamplePayloadRecord(
    examples: Record<string, { value?: unknown }>,
    name: string,
): Record<string, unknown> | undefined {
    const payload = readExamplePayload(examples, name);
    return isRecord(payload) ? payload : undefined;
}

function readExampleEventType(examples: Record<string, { value?: unknown }>, name: string): string | undefined {
    const payload = readExamplePayload(examples, name);
    if (!isRecord(payload) || !isRecord(payload.event)) return undefined;
    return typeof payload.event.type === "string" ? payload.event.type : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

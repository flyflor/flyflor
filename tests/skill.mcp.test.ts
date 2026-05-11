import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    callMcpTool,
    findMcpServer,
    listMcpTools,
    loadMcpServers,
    removeMcpServer,
    setMcpServerEnabled,
    upsertMcpServer,
    validateMcpServers,
} from "../src/agent/mcp/index.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { createSandboxPolicy, decideCapabilityExecution } from "../src/agent/sandbox/index.ts";
import {
    findSkill,
    installSkill,
    loadSkillUsageSummary,
    loadSkills,
    recordSkillUsage,
    resetSkill,
    selectSkills,
    validateSkill,
} from "../src/crystal/skills/index.ts";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { NullEventSink, RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import {
    CapabilityExecutionKind,
    Channel,
    ChatType,
    ModelRole,
    SandboxMode,
    ToolApprovalMode,
    type GatewayMessage,
    type RuntimeEvent,
    type ModelClient,
    type ModelMessage,
} from "../src/protocol/contracts/index.ts";

describe("Skill and MCP capability config", () => {
    test("sandbox resolves capability approval decisions for MCP tools, shell hooks, and plugins", () => {
        const cases = [
            {
                mode: SandboxMode.Off,
                approvals: {},
                expected: {
                    [CapabilityExecutionKind.McpTool]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.ShellHook]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.Plugin]: [false, true, ToolApprovalMode.Deny],
                },
            },
            {
                mode: SandboxMode.Yolo,
                approvals: {},
                expected: {
                    [CapabilityExecutionKind.McpTool]: [true, false, ToolApprovalMode.Allow],
                    [CapabilityExecutionKind.ShellHook]: [true, false, ToolApprovalMode.Allow],
                    [CapabilityExecutionKind.Plugin]: [true, false, ToolApprovalMode.Allow],
                },
            },
            {
                mode: SandboxMode.Off,
                approvals: {
                    mcpToolApproval: ToolApprovalMode.Ask,
                    pluginApproval: ToolApprovalMode.Allow,
                    shellHookApproval: ToolApprovalMode.Deny,
                },
                expected: {
                    [CapabilityExecutionKind.McpTool]: [true, true, ToolApprovalMode.Ask],
                    [CapabilityExecutionKind.ShellHook]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.Plugin]: [true, false, ToolApprovalMode.Allow],
                },
            },
        ] as const;

        for (const item of cases) {
            const policy = createSandboxPolicy({ mode: item.mode, ...item.approvals });
            for (const kind of Object.values(CapabilityExecutionKind)) {
                const [canExecute, requiresApproval, approval] = item.expected[kind];
                const decision = decideCapabilityExecution(policy, kind);
                expect(decision.canExecute).toBe(canExecute);
                expect(decision.requiresApproval).toBe(requiresApproval);
                expect(decision.approval).toBe(approval);
            }
        }
    });

    test("installs, lists, selects, and resets project-local skills", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-skill-"));
        const paths = testPaths(root);
        const source = join(root, "source-skill");
        await mkdir(source, { recursive: true });
        await writeFile(
            join(source, "SKILL.md"),
            [
                "---",
                "name: source-skill",
                "description: Test skill package",
                "---",
                "",
                "Follow the package instructions.",
            ].join("\n"),
        );

        const installed = await installSkill(paths, source, { name: "renamed-skill" });
        expect(installed.name).toBe("renamed-skill");
        expect(installed.source).toBe("project");

        const skills = await loadSkills(paths);
        expect(skills.map((skill) => skill.name)).toEqual(["renamed-skill"]);
        expect(selectSkills(skills, 1).map((skill) => skill.name)).toEqual(["renamed-skill"]);

        const reset = await resetSkill(paths, "renamed-skill");
        expect(reset.removed).toBe(true);
        expect(await loadSkills(paths)).toEqual([]);
    });

    test("shows and validates installed skills with project precedence", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-skill-show-"));
        const paths = testPaths(root);
        const projectSkill = join(paths.projectSkillDir, "alpha");
        const globalSkill = join(paths.skillDir, "alpha");
        await mkdir(join(projectSkill), { recursive: true });
        await mkdir(join(globalSkill), { recursive: true });
        await writeFile(
            join(globalSkill, "SKILL.md"),
            [
                "---",
                "name: alpha",
                "description: Global alpha skill",
                "---",
                "",
                "Global body.",
            ].join("\n"),
        );
        await writeFile(
            join(projectSkill, "SKILL.md"),
            [
                "---",
                "name: alpha",
                "description: Project alpha skill",
                "---",
                "",
                "Project body.",
            ].join("\n"),
        );

        const loaded = await findSkill(paths, "alpha");
        const validation = await validateSkill(paths, "alpha");

        expect(loaded?.source).toBe("project");
        expect(loaded?.description).toBe("Project alpha skill");
        expect(validation.ok).toBe(true);
        expect(validation.skill?.source).toBe("project");
    });

    test("normalizes optional skill manifest metadata for compatible agents", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-skill-manifest-"));
        const paths = testPaths(root);
        const projectSkill = join(paths.projectSkillDir, "portable");
        await mkdir(projectSkill, { recursive: true });
        await writeFile(
            join(projectSkill, "SKILL.md"),
            [
                "---",
                "name: portable",
                "description: Portable skill",
                "compatibility: claude, openclaw",
                "tags: coding, review",
                "---",
                "",
                "Follow portable instructions.",
            ].join("\n"),
        );
        await writeFile(
            join(projectSkill, "skill.json"),
            JSON.stringify(
                {
                    version: "1.2.3",
                    author: "flyflor",
                    compatibleWith: ["hermes-agent"],
                    capabilities: ["code-review"],
                    mcpServers: { filesystem: {} },
                    permissions: { "mcp-tool": true },
                    activation: { manual: true, auto: false },
                },
                null,
                2,
            ),
        );

        const skill = await findSkill(paths, "portable");

        expect(skill?.manifest.version).toBe("1.2.3");
        expect(skill?.manifest.compatibility).toEqual(["hermes-agent", "claude", "openclaw"]);
        expect(skill?.manifest.capabilities).toEqual(["code-review"]);
        expect(skill?.manifest.mcpServers).toEqual(["filesystem"]);
        expect(skill?.manifest.permissions).toEqual(["mcp-tool"]);
        expect(skill?.manifest.activation).toEqual({ manual: true, auto: false });
    });

    test("records project-local skill usage summary for later support scoring", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-skill-usage-"));
        const paths = testPaths(root);
        const projectSkill = join(paths.projectSkillDir, "portable");
        await mkdir(projectSkill, { recursive: true });
        await writeFile(
            join(projectSkill, "SKILL.md"),
            [
                "---",
                "name: portable",
                "description: Portable skill",
                "compatibility: claude, hermes-agent",
                "---",
                "",
                "Follow portable instructions.",
            ].join("\n"),
        );
        const skill = await findSkill(paths, "portable");
        if (!skill) throw new Error("missing test skill");

        const first = await recordSkillUsage(paths, [skill], {
            mcpCallCount: 1,
            mcpSuccessCount: 1,
            now: "2026-05-12T00:00:00.000Z",
            requestId: "req-1",
        });
        const second = await recordSkillUsage(paths, [skill], {
            mcpCallCount: 2,
            mcpSuccessCount: 1,
            now: "2026-05-12T00:01:00.000Z",
            requestId: "req-2",
        });
        const loaded = await loadSkillUsageSummary(paths);
        const jsonl = await readFile(join(paths.projectSkillDir, "skill.usage.jsonl"), "utf8");

        expect(first.skills.portable?.useCount).toBe(1);
        expect(second.skills.portable?.useCount).toBe(2);
        expect(loaded.skills.portable).toMatchObject({
            compatibility: ["claude", "hermes-agent"],
            mcpCallCount: 3,
            mcpSuccessCount: 2,
            source: "project",
            useCount: 2,
        });
        expect(jsonl.trim().split("\n")).toHaveLength(2);
    });

    test("writes MCP servers and loads JSONC-compatible mcpServers config", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-mcp-"));
        const paths = testPaths(root);

        await upsertMcpServer(paths, {
            args: ["mcp-server-filesystem", "/tmp"],
            command: "bunx",
            env: { TOKEN: "secret" },
            name: "filesystem",
        });

        const written = await loadMcpServers(paths);
        expect(written).toEqual([
            {
                args: ["mcp-server-filesystem", "/tmp"],
                command: "bunx",
                enabled: true,
                env: { TOKEN: "secret" },
                name: "filesystem",
                source: "project",
                transport: "stdio",
                url: undefined,
            },
        ]);
        expect(await readFile(join(paths.projectMcpDir, "mcp.json"), "utf8")).toContain('"servers"');

        await writeFile(
            join(paths.projectMcpDir, "mcp.json"),
            [
                "// Claude-style shape",
                "{",
                '  "mcpServers": {',
                '    "remote": { "url": "https://example.invalid/sse", "disabled": true, },',
                "  },",
                "}",
            ].join("\n"),
        );

        const loaded = await loadMcpServers(paths);
        expect(loaded).toEqual([
            {
                args: undefined,
                command: undefined,
                enabled: false,
                env: undefined,
                name: "remote",
                source: "project",
                transport: undefined,
                url: "https://example.invalid/sse",
            },
        ]);
    });

    test("shows, validates, enables, disables, and removes MCP servers", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-mcp-admin-"));
        const paths = testPaths(root);

        await upsertMcpServer(paths, {
            command: "bunx",
            name: "filesystem",
        });
        const shown = await findMcpServer(paths, "filesystem");
        expect(shown?.enabled).toBe(true);

        const validatedBefore = await validateMcpServers(paths);
        expect(validatedBefore[0]?.ok).toBe(true);

        const disabled = await setMcpServerEnabled(paths, "filesystem", false);
        expect(disabled.enabled).toBe(false);
        const validatedAfter = await validateMcpServers(paths);
        expect(validatedAfter[0]?.warnings.join(" ")).toContain("disabled");

        const removed = await removeMcpServer(paths, "filesystem");
        expect(removed.removed).toBe(true);
        expect(await findMcpServer(paths, "filesystem")).toBeUndefined();
    });

    test("lists and calls tools through a stdio MCP server", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-mcp-stdio-"));
        const paths = testPaths(root);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript());
        const server = await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const tools = await listMcpTools(paths, server, { timeoutMs: 2_000 });
        expect(tools).toEqual([
            {
                name: "echo",
                description: "Echo input text",
                inputSchema: {
                    type: "object",
                    properties: {
                        text: { type: "string" },
                    },
                },
            },
        ]);

        const result = await callMcpTool(paths, server, "echo", { text: "hello" }, { timeoutMs: 2_000 });
        expect(result.isError).toBe(false);
        expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    });

    test("lists and calls tools through a streamable HTTP MCP server", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-mcp-http-"));
        const paths = testPaths(root);
        await withFakeHttpMcpServer(async (url) => {
            const server = await upsertMcpServer(paths, {
                name: "remote",
                url,
            });

            const tools = await listMcpTools(paths, server, { timeoutMs: 2_000 });
            const result = await callMcpTool(paths, server, "echo", { text: "remote hello" }, { timeoutMs: 2_000 });

            expect(server.transport).toBe("http");
            expect(tools).toEqual([
                {
                    name: "echo",
                    description: "Echo input text",
                    inputSchema: {
                        type: "object",
                        properties: {
                            text: { type: "string" },
                        },
                    },
                },
            ]);
            expect(result.isError).toBe(false);
            expect(result.content).toEqual([{ type: "text", text: "remote hello" }]);
        });
    });

    test("runtime executes structured MCP tool calls and uses tool results in the final answer", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await installRuntimeTestSkill(paths);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript());
        await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{"text":"from-tool"}}]}</flyflor_mcp_calls>',
            "Final from MCP result.",
            "[]",
        ]);
        const events = new CapturingSink();
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Ask,
                    mode: SandboxMode.Off,
                },
            },
            model,
            events,
        );

        const reply = await runtime.handleMessage(gatewayMessage("use fake echo"), {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            }, {
                approveMcpToolCall: async () => true,
            });

        expect(reply.text).toBe("Final from MCP result.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "fake", tool: "echo" }),
        ]);
        expect(model.messages).toHaveLength(3);
        expect(model.messages[1]?.some((message) => message.role === ModelRole.Tool)).toBe(true);
        expect(model.messages[1]?.find((message) => message.role === ModelRole.Tool)?.content).toContain("from-tool");
        expect(model.messages[2]?.find((message) => message.role === ModelRole.User)?.content).toContain("mcpCalls");
        expect(model.messages[2]?.find((message) => message.role === ModelRole.User)?.content).toContain("from-tool");
        const usage = await loadSkillUsageSummary(paths);
        expect(usage.skills.runtime_helper).toMatchObject({
            mcpCallCount: 1,
            mcpSuccessCount: 1,
            useCount: 1,
        });
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.SkillContextBuilt);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.McpToolCatalogBuilt);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.McpToolCallExecuted);
    });

    test("runtime skips MCP execution when approval is denied", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-deny-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript());
        await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{"text":"from-tool"}}]}</flyflor_mcp_calls>',
            "Final without MCP result.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Ask,
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(
            gatewayMessage("use fake echo"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                approveMcpToolCall: async () => false,
            },
        );

        expect(reply.text).toBe("Final without MCP result.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(model.messages).toHaveLength(2);
        expect(model.messages[1]?.find((message) => message.role === ModelRole.Tool)?.content).toContain("not approved");
    });

    test("runtime executes MCP tool calls without callback when policy allows tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-allow-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript());
        await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{"text":"allowed"}}]}</flyflor_mcp_calls>',
            "Allowed final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Allow,
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("use fake echo"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Allowed final.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(model.messages).toHaveLength(3);
        expect(model.messages[1]?.find((message) => message.role === ModelRole.Tool)?.content).toContain("allowed");
    });

    test("runtime records denied MCP tool calls when ask policy has no approval callback", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-noninteractive-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript());
        await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{"text":"blocked"}}]}</flyflor_mcp_calls>',
            "Noninteractive final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Ask,
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("use fake echo"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Noninteractive final.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(model.messages[1]?.find((message) => message.role === ModelRole.Tool)?.content).toContain("not approved");
    });

    test("runtime hides MCP protocol blocks from streamed output when execution is denied", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-stream-hidden-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new StreamingModel([
            "visible-before ",
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{"text":"hidden"}}]}</flyflor_mcp_calls>',
            " visible-after",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Deny,
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const deltas: string[] = [];
        const reply = await runtime.handleMessage(
            gatewayMessage("try hidden call"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                onTextDelta: (text) => {
                    deltas.push(text);
                },
            },
        );

        expect(deltas.join("")).toBe("visible-before  visible-after");
        expect(reply.text).toBe("visible-before  visible-after");
        expect(deltas.join("")).not.toContain("flyflor_mcp_calls");
        expect(reply.metadata?.mcpToolCalls).toBe(0);
    });
});

function testPaths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: root,
        projectFlyflorDir: join(root, ".flyflor"),
        projectSkillDir: join(root, ".flyflor", "skills"),
        projectMcpDir: join(root, ".flyflor", "mcp"),
        projectPluginDir: join(root, ".flyflor", "plugins"),
        projectMemoryDir: join(root, ".flyflor", "memory"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
    };
}

function fakeMcpServerScript(): string {
    return `
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

function drain() {
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) throw new Error("missing content length");
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    handle(JSON.parse(body));
  }
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}

function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });
    return;
  }
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo input text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } });
    return;
  }
  if (message.method === "tools/call") {
    send({ jsonrpc: "2.0", id: message.id, result: { isError: false, content: [{ type: "text", text: String(message.params?.arguments?.text ?? "") }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
}
`;
}

async function withFakeHttpMcpServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    let sessionId = "";
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.on("end", () => {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                id?: number | string;
                method?: string;
                params?: Record<string, unknown>;
            };
            const writeJson = (body: unknown, headers: Record<string, string> = {}) => {
                response.writeHead(200, { "content-type": "application/json", ...headers });
                response.end(JSON.stringify(body));
            };
            if (payload.method === "initialize") {
                sessionId = crypto.randomUUID();
                writeJson(
                    {
                        jsonrpc: "2.0",
                        id: payload.id,
                        result: {
                            protocolVersion: "2025-06-18",
                            capabilities: {},
                            serverInfo: { name: "fake-http", version: "1" },
                        },
                    },
                    { "Mcp-Session-Id": sessionId },
                );
                return;
            }
            if (payload.method === "notifications/initialized") {
                response.writeHead(202);
                response.end();
                return;
            }
            if (request.headers["mcp-session-id"] !== sessionId) {
                writeJson({ jsonrpc: "2.0", id: payload.id, error: { code: -32001, message: "missing session" } });
                return;
            }
            if (payload.method === "tools/list") {
                writeJson({
                    jsonrpc: "2.0",
                    id: payload.id,
                    result: {
                        tools: [
                            {
                                name: "echo",
                                description: "Echo input text",
                                inputSchema: { type: "object", properties: { text: { type: "string" } } },
                            },
                        ],
                    },
                });
                return;
            }
            if (payload.method === "tools/call") {
                const args = payload.params?.arguments as { text?: unknown } | undefined;
                writeJson({
                    jsonrpc: "2.0",
                    id: payload.id,
                    result: {
                        isError: false,
                        content: [{ type: "text", text: String(args?.text ?? "") }],
                    },
                });
                return;
            }
            writeJson({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method not found" } });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("fake HTTP MCP server did not bind a TCP port");
    }
    try {
        return await fn(`http://127.0.0.1:${address.port}/mcp`);
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

async function installTestTemplates(paths: FlyflorPaths): Promise<void> {
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "prompts"), paths.promptDir);
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "memory"), join(paths.templateDir, "memory"));
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "projects"), join(paths.templateDir, "projects"));
}

async function installRuntimeTestSkill(paths: FlyflorPaths): Promise<void> {
    const root = join(paths.projectSkillDir, "runtime_helper");
    await mkdir(root, { recursive: true });
    await writeFile(
        join(root, "SKILL.md"),
        [
            "---",
            "name: runtime_helper",
            "description: Runtime helper skill",
            "compatibility: flyflor",
            "---",
            "",
            "Keep answers concise.",
        ].join("\n"),
    );
}

async function copyTemplateGroup(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(
        entries.filter((entry) => entry.isFile()).map((entry) => copyFile(join(source, entry.name), join(destination, entry.name))),
    );
}

function gatewayMessage(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        route: {
            channel: Channel.Stdio,
            chatId: "test-chat",
            chatType: ChatType.Direct,
        },
        user: {
            id: "test-user",
        },
        text,
        receivedAt: new Date().toISOString(),
    };
}

class SequencedModel implements ModelClient {
    readonly messages: ModelMessage[][] = [];
    private index = 0;

    constructor(private readonly responses: string[]) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        const response = this.responses[this.index];
        this.index += 1;
        if (response === undefined) {
            throw new Error("SequencedModel response exhausted.");
        }
        return response;
    }
}

class StreamingModel implements ModelClient {
    readonly messages: ModelMessage[][] = [];

    constructor(private readonly chunks: string[]) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.chunks.join("");
    }

    async *stream(messages: ModelMessage[]): AsyncIterable<string> {
        this.messages.push(messages);
        for (const chunk of this.chunks) {
            yield chunk;
        }
    }
}

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

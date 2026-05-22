import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    callMcpTool,
    findMcpServer,
    getMcpPrompt,
    listMcpPrompts,
    listMcpResources,
    listMcpTools,
    loadMcpServers,
    removeMcpServer,
    readMcpResource,
    setMcpServerEnabled,
    upsertMcpServer,
    validateMcpServers,
} from "../src/agent/mcp/index.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { RuntimeSkillUsageEventHandler } from "../src/agent/runtime/events/index.ts";
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
} from "../src/agent/skills/index.ts";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { EventsComponent, NullEventSink, RuntimeEventBus, RuntimeEventType, type EventSink } from "../src/events/index.ts";
import {
    CapabilityExecutionKind,
    Channel,
    ChatType,
    ToolPermission,
    ToolCategory,
    ToolScope,
    ModelRole,
    SandboxMode,
    ToolApprovalMode,
    type GatewayMessage,
    type RuntimeEvent,
    type ModelClient,
    type ModelMessage,
} from "../src/protocol/contracts/index.ts";

const MCP_TRANSPORT_TOKEN_HEADER = String.fromCharCode(109, 99, 112, 45, 115, 101, 115, 115, 105, 111, 110, 45, 105, 100);
const MCP_TRANSPORT_TOKEN_RESPONSE_HEADER = String.fromCharCode(77, 99, 112, 45, 83, 101, 115, 115, 105, 111, 110, 45, 73, 100);

interface TestMcpToolCallProvenance {
    error?: string;
    ok: boolean;
    server: string;
    tool: string;
}

describe("Skill and MCP capability config", () => {
    test("sandbox resolves capability approval decisions for MCP tools, shell hooks, and plugins", () => {
        const cases = [
            {
                mode: SandboxMode.Off,
                approvals: {},
                expected: {
                    [CapabilityExecutionKind.Computer]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.McpTool]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.ShellHook]: [false, true, ToolApprovalMode.Deny],
                    [CapabilityExecutionKind.Plugin]: [false, true, ToolApprovalMode.Deny],
                },
            },
            {
                mode: SandboxMode.Yolo,
                approvals: {},
                expected: {
                    [CapabilityExecutionKind.Computer]: [true, false, ToolApprovalMode.Allow],
                    [CapabilityExecutionKind.McpTool]: [true, false, ToolApprovalMode.Allow],
                    [CapabilityExecutionKind.ShellHook]: [true, false, ToolApprovalMode.Allow],
                    [CapabilityExecutionKind.Plugin]: [true, false, ToolApprovalMode.Allow],
                },
            },
            {
                mode: SandboxMode.Off,
                approvals: {
                    computerApproval: ToolApprovalMode.Deny,
                    mcpToolApproval: ToolApprovalMode.Ask,
                    pluginApproval: ToolApprovalMode.Allow,
                    shellHookApproval: ToolApprovalMode.Deny,
                },
                expected: {
                    [CapabilityExecutionKind.Computer]: [false, true, ToolApprovalMode.Deny],
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
            ["---", "name: alpha", "description: Global alpha skill", "---", "", "Global body."].join("\n"),
        );
        await writeFile(
            join(projectSkill, "SKILL.md"),
            ["---", "name: alpha", "description: Project alpha skill", "---", "", "Project body."].join("\n"),
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
                    compatibleWith: ["flyflor"],
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
        expect(skill?.manifest.compatibility).toEqual(["flyflor", "claude", "openclaw"]);
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
                "compatibility: claude, flyflor",
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
            compatibility: ["claude", "flyflor"],
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
        const resources = await listMcpResources(paths, server, { timeoutMs: 2_000 });
        const prompts = await listMcpPrompts(paths, server, { timeoutMs: 2_000 });
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
        expect(resources).toEqual([
            {
                uri: "file://notes.md",
                name: "notes",
                description: "Project notes",
                mimeType: "text/markdown",
            },
        ]);
        expect(prompts).toEqual([
            {
                name: "review",
                description: "Review prompt",
                arguments: [{ name: "path", required: true }],
            },
        ]);

        const result = await callMcpTool(paths, server, "echo", { text: "hello" }, { timeoutMs: 2_000 });
        const resource = await readMcpResource(paths, server, "file://notes.md", { timeoutMs: 2_000 });
        const prompt = await getMcpPrompt(paths, server, "review", { path: "README.md" }, { timeoutMs: 2_000 });
        expect(result.isError).toBe(false);
        expect(result.content).toEqual([{ type: "text", text: "hello" }]);
        expect(resource.contents).toEqual([{ uri: "file://notes.md", mimeType: "text/markdown", text: "# Notes" }]);
        expect(prompt.messages).toEqual([{ role: "user", content: { type: "text", text: "Review README.md" } }]);
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
            const resources = await listMcpResources(paths, server, { timeoutMs: 2_000 });
            const prompts = await listMcpPrompts(paths, server, { timeoutMs: 2_000 });
            const result = await callMcpTool(paths, server, "echo", { text: "remote hello" }, { timeoutMs: 2_000 });
            const resource = await readMcpResource(paths, server, "https://mcp.test/resource/notes", {
                timeoutMs: 2_000,
            });
            const prompt = await getMcpPrompt(paths, server, "remote-review", { topic: "runtime" }, { timeoutMs: 2_000 });

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
            expect(resources).toEqual([
                {
                    uri: "https://mcp.test/resource/notes",
                    name: "remote-notes",
                    description: "Remote notes",
                    mimeType: "text/plain",
                },
            ]);
            expect(prompts).toEqual([
                {
                    name: "remote-review",
                    description: "Remote review prompt",
                    arguments: [{ name: "topic" }],
                },
            ]);
            expect(result.isError).toBe(false);
            expect(result.content).toEqual([{ type: "text", text: "remote hello" }]);
            expect(resource.contents).toEqual([
                { uri: "https://mcp.test/resource/notes", mimeType: "text/plain", text: "remote notes" },
            ]);
            expect(prompt.messages).toEqual([{ role: "user", content: { type: "text", text: "Review runtime" } }]);
        });
    });

    test("runtime reuses stale MCP catalog when refresh fails", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-mcp-catalog-stale-"));
        const paths = testPaths(root);
        await withControllableHttpMcpServer(async (url, control) => {
            const server = await upsertMcpServer(paths, { name: "remote", url });
            const baseConfig = await loadConfigForPaths(paths);
            const runtime = new RuntimeModule(baseConfig, new SequencedModel([]), new CapturingSink());
            const build = (
                runtime as unknown as {
                    buildMcpToolCatalog: (
                        servers: unknown[],
                        canExecuteTools: boolean,
                        requestId: string,
                    ) => Promise<{ entries: Array<{ server: string; tool: { name: string } }>; failedServers: string[]; staleServers: string[] }>;
                    mcpToolCatalogCache: Map<string, { expiresAt: number }>;
                }
            ).buildMcpToolCatalog.bind(runtime);

            const first = await build([server], true, "req-catalog-1");
            expect(first.entries.map((entry) => `${entry.server}.${entry.tool.name}`)).toEqual(["remote.echo"]);
            expect(first.staleServers).toEqual([]);

            for (const cached of (
                runtime as unknown as { mcpToolCatalogCache: Map<string, { expiresAt: number }> }
            ).mcpToolCatalogCache.values()) {
                cached.expiresAt = 0;
            }
            control.failToolsList = true;

            const second = await build([server], true, "req-catalog-2");
            expect(second.entries.map((entry) => `${entry.server}.${entry.tool.name}`)).toEqual(["remote.echo"]);
            expect(second.failedServers).toEqual(["remote"]);
            expect(second.staleServers).toEqual(["remote"]);
        });
    });

    test("runtime reads MCP resources through the controlled capability boundary", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-resource-read-"));
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
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Allow,
                    mode: SandboxMode.Off,
                },
            },
            new SequencedModel([]),
            new CapturingSink(),
        );

        const resource = await runtime.readMcpResource({
            requestId: "req-resource",
            server: "fake",
            uri: "file://notes.md",
        });

        expect(resource.contents).toEqual([{ uri: "file://notes.md", mimeType: "text/markdown", text: "# Notes" }]);
    });

    test("runtime gets MCP prompts through the controlled capability boundary", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-prompt-get-"));
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
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mcpToolApproval: ToolApprovalMode.Allow,
                    mode: SandboxMode.Off,
                },
            },
            new SequencedModel([]),
            new CapturingSink(),
        );

        const prompt = await runtime.getMcpPrompt({
            arguments: { path: "README.md" },
            requestId: "req-prompt",
            server: "fake",
            name: "review",
        });

        expect(prompt.messages).toEqual([{ role: "user", content: { type: "text", text: "Review README.md" } }]);
    });

    test("runtime exposes and executes user manifest process-json tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-user-tool-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await mkdir(join(root, "tools"), { recursive: true });
        await mkdir(paths.projectFlyflorDir, { recursive: true });
        const script = join(root, "tools", "echo.tool.js");
        await writeFile(script, userToolScript());
        await writeFile(
            join(paths.projectFlyflorDir, "tools.jsonc"),
            JSON.stringify({
                tools: {
                    "local.echo": {
                        description: "Echo through user tool",
                        inputSchema: {
                            type: "object",
                            properties: { text: { type: "string" } },
                            required: ["text"],
                        },
                        permission: ToolPermission.Execute,
                        scope: [ToolScope.Local],
                        category: ToolCategory.System,
                        readOnly: true,
                        concurrencySafe: true,
                        exclusive: false,
                        executor: {
                            kind: "process-json",
                            command: process.execPath,
                            args: [script],
                            cwd: "project",
                        },
                    },
                },
            }),
        );

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"local.echo","input":{"text":"hello user tool"}}]}</flyflor_mcp_calls>',
            "Final from user tool.",
            "[]",
        ]);
        const sink = new CapturingSink();
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            sink,
        );

        const reply = await runtime.handleMessage(gatewayMessage("use user tool"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Final from user tool.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "user", tool: "local.echo" }),
        ]);
        expect(reply.metadata?.executiveToolExecutions).toEqual([
            expect.objectContaining({
                capabilityKind: CapabilityExecutionKind.Plugin,
                key: "user.local.echo",
                ok: true,
                requiresApproval: true,
                resultSummary: expect.stringContaining("hello user tool"),
            }),
        ]);
        const toolResultText = model.messages
            .flat()
            .filter((message) => message.role === ModelRole.User)
            .map((message) => message.content)
            .join("\n");
        expect(toolResultText).toContain("hello user tool");
        const catalogEvent = sink.events.find((item) => item.type === RuntimeEventType.McpCapabilityCatalogBuilt);
        expect(catalogEvent?.payload).toMatchObject({
            tools: expect.arrayContaining(["user.local.echo"]),
        });
    });

    test("runtime denies user manifest tools when plugin sandbox denies execution", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-user-tool-deny-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await mkdir(join(root, "tools"), { recursive: true });
        await mkdir(paths.projectFlyflorDir, { recursive: true });
        const script = join(root, "tools", "echo.tool.js");
        await writeFile(script, userToolScript());
        await writeFile(
            join(paths.projectFlyflorDir, "tools.jsonc"),
            JSON.stringify({
                tools: {
                    "local.echo": {
                        description: "Echo through user tool",
                        inputSchema: { type: "object" },
                        permission: ToolPermission.Execute,
                        scope: [ToolScope.Local],
                        category: ToolCategory.System,
                        executor: {
                            kind: "process-json",
                            command: process.execPath,
                            args: [script],
                        },
                    },
                },
            }),
        );

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"local.echo","input":{"text":"blocked"}}]}</flyflor_mcp_calls>',
            "Denied final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Deny,
                },
            },
            model,
            new CapturingSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("use blocked user tool"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Denied final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "user", tool: "local.echo" }),
        ]);
        const executions = reply.metadata?.mcpToolExecutions as TestMcpToolCallProvenance[] | undefined;
        expect(executions?.[0]?.error).toContain("plugin execution is denied");
    });

    test("runtime rejects user manifest tool calls that violate input schema", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-user-tool-schema-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await mkdir(join(root, "tools"), { recursive: true });
        await mkdir(paths.projectFlyflorDir, { recursive: true });
        const script = join(root, "tools", "echo.tool.js");
        await writeFile(script, userToolScript());
        await writeFile(
            join(paths.projectFlyflorDir, "tools.jsonc"),
            JSON.stringify({
                tools: {
                    "local.echo": {
                        description: "Echo through user tool",
                        inputSchema: {
                            type: "object",
                            properties: { text: { type: "string" } },
                            required: ["text"],
                        },
                        permission: ToolPermission.Execute,
                        scope: [ToolScope.Local],
                        category: ToolCategory.System,
                        executor: {
                            kind: "process-json",
                            command: process.execPath,
                            args: [script],
                        },
                    },
                },
            }),
        );

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"local.echo","input":{}}]}</flyflor_mcp_calls>',
            "Schema final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            new CapturingSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("use bad user tool"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Schema final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "user", tool: "local.echo" }),
        ]);
        const executions = reply.metadata?.mcpToolExecutions as TestMcpToolCallProvenance[] | undefined;
        expect(executions?.[0]?.error).toContain("inputSchema");
    });

    test("runtime exposes and executes plugin capability descriptors through the Executive tool loop", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-plugin-capability-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await installTestPluginCapability(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"plugin.demo.echo","input":{"text":"hello plugin"}}]}</flyflor_mcp_calls>',
            "Plugin final.",
            "[]",
        ]);
        const sink = new CapturingSink();
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            sink,
        );

        const reply = await runtime.handleMessage(gatewayMessage("use plugin capability"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Plugin final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "user", tool: "plugin.demo.echo" }),
        ]);
        const toolResultText = model.messages
            .flat()
            .filter((message) => message.role === ModelRole.User)
            .map((message) => message.content)
            .join("\n");
        expect(toolResultText).toContain("hello plugin");
        const catalogEvent = sink.events.find((item) => item.type === RuntimeEventType.McpCapabilityCatalogBuilt);
        expect(catalogEvent?.payload).toMatchObject({
            tools: expect.arrayContaining(["user.plugin.demo.echo"]),
        });
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.PluginInvokeStart);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.PluginInvokeEnd);
    });

    test("runtime rejects plugin capability calls that violate input schema", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-plugin-schema-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await installTestPluginCapability(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"plugin.demo.echo","input":{}}]}</flyflor_mcp_calls>',
            "Plugin schema final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("use malformed plugin capability"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Plugin schema final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "user", tool: "plugin.demo.echo" }),
        ]);
        const executions = reply.metadata?.mcpToolExecutions as TestMcpToolCallProvenance[] | undefined;
        expect(executions?.[0]?.error).toContain("inputSchema");
    });

    test("runtime keeps plugin capability execution behind plugin sandbox approval", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-plugin-deny-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await installTestPluginCapability(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"user","tool":"plugin.demo.echo","input":{"text":"blocked"}}]}</flyflor_mcp_calls>',
            "Plugin denied final.",
        ]);
        const sink = new CapturingSink();
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    pluginApproval: ToolApprovalMode.Ask,
                },
            },
            model,
            sink,
        );

        const reply = await runtime.handleMessage(
            gatewayMessage("use denied plugin capability"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                approveMcpToolCall: async () => false,
            },
        );

        expect(reply.text).toBe("Plugin denied final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "user", tool: "plugin.demo.echo" }),
        ]);
        const executions = reply.metadata?.mcpToolExecutions as TestMcpToolCallProvenance[] | undefined;
        expect(executions?.[0]?.error).toContain("not approved");
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.SandboxToolApprovalRequested);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.SandboxToolApprovalDenied);
        expect(sink.events.map((item) => item.type)).not.toContain(RuntimeEventType.PluginInvokeStart);
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
        const sink = new CapturingSink();
        const events = new EventsComponent(sink, new RuntimeEventBus());
        const disposeHooks = events.registerHooks(new RuntimeSkillUsageEventHandler({ paths }));
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

        const reply = await runtime.handleMessage(
            gatewayMessage("use fake echo"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                approveMcpToolCall: async () => true,
            },
        );

        expect(reply.text).toBe("Final from MCP result.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "fake", tool: "echo" }),
        ]);
        expect(reply.metadata?.executiveToolExecutions).toEqual([
            expect.objectContaining({
                capabilityKind: CapabilityExecutionKind.McpTool,
                key: "fake.echo",
                ok: true,
                requiresApproval: true,
                resultSummary: expect.stringContaining("from-tool"),
            }),
        ]);
        expect(model.messages).toHaveLength(3);
        expect(model.messages[1]?.some((message) => message.role === ModelRole.User)).toBe(true);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain("from-tool");
        expect(model.messages[2]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain("mcpCalls");
        expect(model.messages[2]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain("from-tool");
        const usage = await loadSkillUsageSummary(paths);
        expect(usage.skills.runtime_helper).toMatchObject({
            mcpCallCount: 1,
            mcpSuccessCount: 1,
            useCount: 1,
        });
        for (const dispose of disposeHooks) {
            dispose();
        }
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.SkillContextBuilt);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.McpCapabilityCatalogBuilt);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.McpToolCatalogBuilt);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.McpToolCallExecuted);
        const capabilityEvent = sink.events.find((item) => item.type === RuntimeEventType.McpCapabilityCatalogBuilt);
        expect(capabilityEvent?.payload).toMatchObject({
            prompts: ["fake.review"],
            resources: ["fake:file://notes.md"],
            tools: expect.arrayContaining(["fake.echo", "workspace.list"]),
        });
    });

    test("runtime returns MCP input schema violations through the Executive tool loop", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-mcp-schema-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const script = join(root, "fake.mcp.server.js");
        await writeFile(script, fakeMcpServerScript({ requireEchoText: true }));
        await upsertMcpServer(paths, {
            args: [script],
            command: process.execPath,
            name: "fake",
        });

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"fake","tool":"echo","input":{}}]}</flyflor_mcp_calls>',
            "Schema final.",
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

        const reply = await runtime.handleMessage(gatewayMessage("use malformed fake echo"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Schema final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "fake", tool: "echo" }),
        ]);
        const executions = reply.metadata?.mcpToolExecutions as TestMcpToolCallProvenance[] | undefined;
        expect(executions?.[0]?.error).toContain("inputSchema");
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "inputSchema",
        );
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
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "not approved",
        );
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
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain("allowed");
    });

    test("runtime exposes and executes built-in shell.run when shell hooks are allowed", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-shell-run-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"shell","tool":"run","input":{"command":"pwd"}}]}</flyflor_mcp_calls>',
            "Shell final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    shellHookApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("run pwd"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Shell final.");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "shell", tool: "run" }),
        ]);
        expect(model.messages[0]?.find((message) => message.role === ModelRole.System)?.content).toContain(
            '"name": "shell"',
        );
        expect(model.messages[0]?.find((message) => message.role === ModelRole.System)?.content).toContain(
            '"name": "run"',
        );
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(paths.projectDir);
    });

    test("runtime exposes shell.run behind approval when shell hooks ask", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-shell-ask-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"shell","tool":"run","input":{"command":"pwd"}}]}</flyflor_mcp_calls>',
            "Shell ask final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    shellHookApproval: ToolApprovalMode.Ask,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(
            gatewayMessage("can you run pwd"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                approveMcpToolCall: async () => true,
            },
        );

        expect(reply.text).toBe("Shell ask final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "shell", tool: "run" }),
        ]);
        const systemPrompt = model.messages[0]?.find((message) => message.role === ModelRole.System)?.content ?? "";
        expect(systemPrompt).toContain('"name": "shell"');
        expect(systemPrompt).toContain("approved local process");
        expect(systemPrompt).not.toContain("local command discovery");
    });

    test("runtime exposes and executes read-only git tools when shell hooks are allowed", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-git-tools-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await initGitRepo(root);
        await writeFile(join(root, "tracked.txt"), "changed\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"git","tool":"status","input":{}},{"server":"git","tool":"diff","input":{"path":"tracked.txt","context":1}}]}</flyflor_mcp_calls>',
            "Git final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    shellHookApproval: ToolApprovalMode.Allow,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("review local git changes"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Git final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "git", tool: "status" }),
            expect.objectContaining({ ok: true, server: "git", tool: "diff" }),
        ]);
        const systemPrompt = model.messages[0]?.find((message) => message.role === ModelRole.System)?.content ?? "";
        expect(systemPrompt).toContain('"name": "git"');
        expect(systemPrompt).toContain('"name": "status"');
        expect(systemPrompt).toContain('"name": "diff"');
        const toolResultText = model.messages
            .flat()
            .filter((message) => message.role === ModelRole.User)
            .map((message) => message.content)
            .join("\n");
        expect(toolResultText).toContain("tracked.txt");
        expect(toolResultText).toContain("-initial");
        expect(toolResultText).toContain("+changed");
    });

    test("runtime keeps git tools behind shell-hook approval", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-git-ask-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await initGitRepo(root);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"git","tool":"status","input":{}}]}</flyflor_mcp_calls>',
            "Git denied final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    shellHookApproval: ToolApprovalMode.Ask,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("git status"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Git denied final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "git", tool: "status" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "not approved",
        );
    });

    test("runtime exposes read-only workspace tools without shell approval", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "notes.txt"), "alpha\nneedle line\nomega\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"notes.txt"}}]}</flyflor_mcp_calls>',
            "Workspace final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                    shellHookApproval: ToolApprovalMode.Deny,
                    mcpToolApproval: ToolApprovalMode.Deny,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("read notes"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Workspace final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        const systemPrompt = model.messages[0]?.find((message) => message.role === ModelRole.System)?.content ?? "";
        expect(systemPrompt).toContain('"name": "workspace"');
        expect(systemPrompt).toContain('"name": "read"');
        expect(systemPrompt).toContain('"name": "search"');
        expect(systemPrompt).toContain('"name": "glob"');
        expect(systemPrompt).toContain('"name": "stat"');
        expect(systemPrompt).not.toContain('"name": "shell"');
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain("needle line");
    });

    test("runtime executes workspace glob and stat for project inspection loops", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-glob-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await mkdir(join(root, "src", "agent"), { recursive: true });
        await writeFile(join(root, "src", "agent", "tool.ts"), "export const tool = true;\n");
        await writeFile(join(root, "src", "index.ts"), "export * from './agent/tool';\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"glob","input":{"pattern":"**/*.ts","path":"src"}}]}</flyflor_mcp_calls>',
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"stat","input":{"path":"src/agent/tool.ts"}}]}</flyflor_mcp_calls>',
            "Glob stat final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("inspect source files"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Glob stat final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "glob" }),
            expect.objectContaining({ ok: true, server: "workspace", tool: "stat" }),
        ]);
        const toolResultText = model.messages
            .flat()
            .filter((message) => message.role === ModelRole.User)
            .map((message) => message.content)
            .join("\n");
        expect(toolResultText).toContain("src/agent/tool.ts");
        expect(toolResultText).toContain("src/index.ts");
        expect(toolResultText).toContain('"type": "file"');
    });

    test("runtime allows multiple workspace tool turns by default", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-multi-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "package.json"), JSON.stringify({ name: "multi-turn-app" }));
        await writeFile(join(root, "README.md"), "multi turn readme\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"list","input":{"path":"."}}]}</flyflor_mcp_calls>',
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"package.json"}}]}</flyflor_mcp_calls>',
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"search","input":{"query":"multi turn","path":"README.md"}}]}</flyflor_mcp_calls>',
            "Multi final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("inspect project"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Multi final.");
        expect(reply.metadata?.mcpToolCalls).toBe(3);
        expect(model.messages).toHaveLength(5);
        expect(model.messages[3]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "multi turn readme",
        );
    });

    test("runtime returns an ask when maxToolTurns is exhausted", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-tool-budget-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "one.txt"), "one\n");
        await writeFile(join(root, "two.txt"), "two\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"one.txt"}}]}</flyflor_mcp_calls>',
            "[]",
        ]);
        const events = new CapturingSink();
        const runtime = new RuntimeModule(baseConfig, model, events);

        const reply = await runtime.handleMessage(
            gatewayMessage("inspect with small budget"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            { maxToolTurns: 1 },
        );

        expect(reply.metadata?.kind).toBe("ask");
        expect(reply.text).toContain("工具调用预算已用完");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(reply.metadata?.executiveToolLoop).toEqual(
            expect.objectContaining({
                askId: expect.any(String),
                loopGuardSnapshot: expect.objectContaining({
                    totalCalls: 1,
                }),
                resume: { mode: "continue" },
                stepCount: 1,
                stop: "ask",
                toolBudgetExhausted: true,
            }),
        );
        expect(events.events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: RuntimeEventType.ExecutiveLoopPaused,
                    payload: expect.objectContaining({
                        stepCount: 1,
                        toolBudgetExhausted: true,
                    }),
                }),
            ]),
        );
        expect(model.messages).toHaveLength(2);
    });

    test("runtime resume turn carries Executive pause ghost and continues tool execution", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-tool-resume-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "one.txt"), "one\n");
        await writeFile(join(root, "two.txt"), "two\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"one.txt"}}]}</flyflor_mcp_calls>',
            "[]",
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"two.txt"}}]}</flyflor_mcp_calls>',
            "Finished after continuing.",
            "[]",
        ]);
        const events = new CapturingSink();
        const runtime = new RuntimeModule(baseConfig, model, events);
        const context = {
            activeScope: {
                id: "scope-runtime-tool-resume",
                projectDir: paths.projectDir,
                projectMemoryDir: paths.projectMemoryDir,
            },
        };

        const paused = await runtime.handleMessage(
            gatewayMessage("inspect both files"),
            {
                ...context,
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            { maxToolTurns: 1 },
        );

        expect(paused.metadata?.kind).toBe("ask");
        expect(paused.text).toContain("workspace.read:ok");
        expect(paused.metadata?.ask).toEqual(
            expect.objectContaining({
                prompt: expect.stringContaining("workspace.read:ok"),
            }),
        );
        expect(paused.metadata?.executiveToolLoop).toEqual(
            expect.objectContaining({
                resume: { mode: "continue" },
                stop: "ask",
                toolBudgetExhausted: true,
            }),
        );

        const resumed = await runtime.handleMessage(
            gatewayMessage("continue-tools"),
            {
                ...context,
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            { maxToolTurns: 2 },
        );

        expect(resumed.metadata?.kind).toBe("reply");
        expect(resumed.text).toBe("Finished after continuing.");
        expect(resumed.metadata?.executiveToolExecutions).toEqual([
            expect.objectContaining({ ok: true, key: "workspace.read" }),
        ]);
        const resumedPrompt =
            model.messages
                .map((messages) => messages.map((message) => message.content).join("\n"))
                .find((content) => content.includes("[continuation]")) ?? "";
        expect(resumedPrompt).toContain("[continuation]");
        expect(events.events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: RuntimeEventType.ExecutiveLoopPaused }),
                expect.objectContaining({ type: RuntimeEventType.ExecutiveLoopResumed }),
                expect.objectContaining({
                    type: RuntimeEventType.McpToolCallExecuted,
                    payload: expect.objectContaining({
                        ok: true,
                        server: "workspace",
                        tool: "read",
                    }),
                }),
            ]),
        );
    });

    test("runtime follows through on short confirmations by executing structured tool calls", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-short-confirm-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "todo.txt"), "confirmed follow-through\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"todo.txt"}}]}</flyflor_mcp_calls>',
            "Done after reading todo.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("ok do it"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Done after reading todo.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "confirmed follow-through",
        );
    });

    test("runtime feeds Executive loop guard diagnostics back after repeated failed tool calls", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-loop-guard-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const repeatedFailure =
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"missing.txt"}}]}</flyflor_mcp_calls>';
        const model = new SequencedModel([repeatedFailure, repeatedFailure, repeatedFailure, repeatedFailure, "[]"]);
        const events = new CapturingSink();
        const runtime = new RuntimeModule(baseConfig, model, events);

        const reply = await runtime.handleMessage(gatewayMessage("read missing repeatedly"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.metadata?.kind).toBe("ask");
        expect(reply.text).toContain("执行层连续遇到工具阻断");
        expect(reply.metadata?.mcpToolExecutions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ ok: false, server: "workspace", tool: "read" }),
            ]),
        );
        expect(reply.metadata?.executiveToolLoop).toEqual(
            expect.objectContaining({
                askId: expect.any(String),
                loopGuardReason: "failed-call-repeat",
                loopGuardSnapshot: expect.objectContaining({
                    failedCallRepeatCounts: expect.any(Object),
                    totalCalls: 3,
                }),
                resume: { mode: "continue" },
                stepCount: 3,
                stop: "ask",
            }),
        );
        const toolResultText = model.messages
            .flat()
            .filter((message) => message.role === ModelRole.User)
            .map((message) => message.content)
            .join("\n");
        expect(toolResultText).toContain("executive-loop-guard");
        expect(toolResultText).toContain("failed-call-repeat");
        expect(events.events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: RuntimeEventType.ExecutiveLoopGuardBlocked,
                    payload: expect.objectContaining({
                        reason: "failed-call-repeat",
                        server: "workspace",
                        tool: "read",
                    }),
                }),
            ]),
        );
        expect(model.messages.at(-1)?.[0]?.content).toContain("executiveToolLoop");
        expect(events.events).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: RuntimeEventType.ExecutiveLoopPaused,
                    payload: expect.objectContaining({
                        loopGuardReason: "failed-call-repeat",
                        loopGuardSnapshot: expect.objectContaining({
                            totalCalls: 3,
                        }),
                        stepCount: 3,
                    }),
                }),
            ]),
        );
    });

    test("runtime keeps looping beyond the old small default until the model finalizes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-loop-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const files = Array.from({ length: 8 }, (_, index) => `file${index + 1}.txt`);
        for (const file of files) {
            await writeFile(join(root, file), `loop content ${file}`);
        }

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            ...files.map(
                (file) =>
                    `<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"${file}"}}]}</flyflor_mcp_calls>`,
            ),
            "Loop final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("loop inspect"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Loop final.");
        expect(reply.metadata?.mcpToolCalls).toBe(files.length);
        expect(model.messages).toHaveLength(files.length + 2);
        expect(model.messages.at(-2)?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "loop content file8.txt",
        );
    });

    test("runtime accepts batched workspace calls beyond the old per-message limit", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-batch-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const files = Array.from({ length: 6 }, (_, index) => `batch${index + 1}.txt`);
        for (const file of files) {
            await writeFile(join(root, file), `batch content ${file}`);
        }

        const baseConfig = await loadConfigForPaths(paths);
        const batchCalls = files.map((file) => ({
            server: "workspace",
            tool: "read",
            input: { path: file },
        }));
        const model = new SequencedModel([
            `<flyflor_mcp_calls>${JSON.stringify({ calls: batchCalls })}</flyflor_mcp_calls>`,
            "Batch final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("batch inspect"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Batch final.");
        expect(reply.metadata?.mcpToolCalls).toBe(files.length);
        expect(reply.metadata?.mcpToolExecutions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
            ]),
        );
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "batch content batch6.txt",
        );
    });

    test("runtime accepts common MCP name/arguments call shape for workspace tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-shape-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "README.md"), "shape-compatible read\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"name":"workspace.read","arguments":{"path":"README.md"}}]}</flyflor_mcp_calls>',
            "Shape final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("read readme"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Shape final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "shape-compatible read",
        );
    });

    test("runtime lifts top-level workspace tool arguments into input", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-lift-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "README.md"), "top-level path read\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","path":"README.md"}]}</flyflor_mcp_calls>',
            "Lift final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("read readme"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Lift final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "top-level path read",
        );
    });

    test("runtime accepts OpenAI-style function call shape for workspace tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-function-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "README.md"), "function-call path read\n");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"tool_calls":[{"type":"function","function":{"name":"workspace.read","arguments":"{\\"path\\":\\"README.md\\"}"}}]}</flyflor_mcp_calls>',
            "Function final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        const reply = await runtime.handleMessage(gatewayMessage("read readme"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Function final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "function-call path read",
        );
    });

    test("runtime rejects unrecognized tool call shapes instead of silently dropping them", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-bad-shape-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            'Visible before <flyflor_mcp_calls>{"calls":[{"path":"."}]}</flyflor_mcp_calls> visible after',
            "[]",
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        await expect(
            runtime.handleMessage(gatewayMessage("bad call shape"), {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            }),
        ).rejects.toThrow("Invalid MCP tool call at mcpCalls[0].calls[0]: missing server/tool identity.");
    });

    test("runtime rejects malformed string arguments with a structured MCP call path", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-bad-args-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"tool_calls":[{"type":"function","function":{"name":"workspace.read","arguments":"not-json"}}]}</flyflor_mcp_calls>',
        ]);
        const runtime = new RuntimeModule(baseConfig, model, new NullEventSink());

        await expect(
            runtime.handleMessage(gatewayMessage("bad call args"), {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            }),
        ).rejects.toThrow("Invalid MCP tool call at mcpCalls[0].tool_calls[0].function.arguments: expected valid JSON object.");
    });

    test("workspace tools require approval for paths outside the project root", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-escape-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await writeFile(join(root, "..", "outside.txt"), "outside");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":"../outside.txt"}}]}</flyflor_mcp_calls>',
            "Escape final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("read outside"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Escape final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "not approved",
        );
    });

    test("workspace glob requires approval for directories outside the project root", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-glob-escape-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        await mkdir(join(root, "..", "outside-dir"), { recursive: true });
        await writeFile(join(root, "..", "outside-dir", "outside.ts"), "outside");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            '<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"glob","input":{"path":"../outside-dir","pattern":"*.ts"}}]}</flyflor_mcp_calls>',
            "Glob escape final.",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("glob outside"), {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
        });

        expect(reply.text).toBe("Glob escape final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: false, server: "workspace", tool: "glob" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "not approved",
        );
    });

    test("workspace tools can read approved absolute paths outside the project root", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-runtime-workspace-absolute-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const outside = join(root, "..", "outside-approved.txt");
        await writeFile(outside, "approved outside read");

        const baseConfig = await loadConfigForPaths(paths);
        const model = new SequencedModel([
            `<flyflor_mcp_calls>{"calls":[{"server":"workspace","tool":"read","input":{"path":${JSON.stringify(outside)}}}]}</flyflor_mcp_calls>`,
            "Approved final.",
            "[]",
        ]);
        const runtime = new RuntimeModule(
            {
                ...baseConfig,
                sandbox: {
                    mode: SandboxMode.Off,
                },
            },
            model,
            new NullEventSink(),
        );

        const reply = await runtime.handleMessage(
            gatewayMessage("read approved outside"),
            {
                requestId: crypto.randomUUID(),
                now: new Date().toISOString(),
            },
            {
                approveMcpToolCall: async () => true,
            },
        );

        expect(reply.text).toBe("Approved final.");
        expect(reply.metadata?.mcpToolExecutions).toEqual([
            expect.objectContaining({ ok: true, server: "workspace", tool: "read" }),
        ]);
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "approved outside read",
        );
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
        expect(model.messages[1]?.filter((message) => message.role === ModelRole.User).at(-1)?.content).toContain(
            "not approved",
        );
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
        expect(reply.metadata?.kind).toBe("reply");
        expect(reply.metadata?.mcpToolCalls).toBe(1);
        expect(reply.metadata?.mcpToolExecutions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ ok: false, server: "fake", tool: "echo" }),
            ]),
        );
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

function fakeMcpServerScript(options: { requireEchoText?: boolean } = {}): string {
    const echoInputSchema = options.requireEchoText
        ? '{ type: "object", properties: { text: { type: "string" } }, required: ["text"] }'
        : '{ type: "object", properties: { text: { type: "string" } } }';
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
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo input text", inputSchema: ${echoInputSchema} }] } });
    return;
  }
  if (message.method === "resources/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { resources: [{ uri: "file://notes.md", name: "notes", description: "Project notes", mimeType: "text/markdown" }] } });
    return;
  }
  if (message.method === "prompts/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { prompts: [{ name: "review", description: "Review prompt", arguments: [{ name: "path", required: true }] }] } });
    return;
  }
  if (message.method === "resources/read") {
    send({ jsonrpc: "2.0", id: message.id, result: { contents: [{ uri: message.params?.uri, mimeType: "text/markdown", text: "# Notes" }] } });
    return;
  }
  if (message.method === "prompts/get") {
    const path = String(message.params?.arguments?.path ?? "");
    send({ jsonrpc: "2.0", id: message.id, result: { description: "Review prompt", messages: [{ role: "user", content: { type: "text", text: "Review " + path } }] } });
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

function userToolScript(): string {
    return `
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  body += chunk;
});
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  process.stdout.write(JSON.stringify({ echoed: payload.input?.text ?? null, tool: payload.tool }) + "\\n");
});
`;
}

function pluginCapabilityScript(): string {
    return `
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  body += chunk;
});
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  process.stdout.write(JSON.stringify({ echoed: payload.input?.text ?? null, capability: payload.capability }) + "\\n");
});
`;
}

async function withFakeHttpMcpServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
    let transportToken = "";
    return withMockHttpMcpEndpoint("fake", async (request) => {
        const payload = (await request.json()) as {
            id?: number | string;
            method?: string;
            params?: Record<string, unknown>;
        };
        if (payload.method === "initialize") {
            transportToken = crypto.randomUUID();
            return jsonResponse(
                {
                    jsonrpc: "2.0",
                    id: payload.id,
                    result: {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        serverInfo: { name: "fake-http", version: "1" },
                    },
                },
                { [MCP_TRANSPORT_TOKEN_RESPONSE_HEADER]: transportToken },
            );
        }
        if (payload.method === "notifications/initialized") {
            return new Response(null, { status: 202 });
        }
        if (request.headers.get(MCP_TRANSPORT_TOKEN_HEADER) !== transportToken) {
            return jsonResponse({ jsonrpc: "2.0", id: payload.id, error: { code: -32001, message: "missing transport token" } });
        }
        if (payload.method === "tools/list") {
            return jsonResponse({ jsonrpc: "2.0", id: payload.id, result: { tools: [httpEchoTool()] } });
        }
        if (payload.method === "resources/list") {
            return jsonResponse({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    resources: [
                        {
                            uri: "https://mcp.test/resource/notes",
                            name: "remote-notes",
                            description: "Remote notes",
                            mimeType: "text/plain",
                        },
                    ],
                },
            });
        }
        if (payload.method === "prompts/list") {
            return jsonResponse({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    prompts: [
                        {
                            name: "remote-review",
                            description: "Remote review prompt",
                            arguments: [{ name: "topic" }],
                        },
                    ],
                },
            });
        }
        if (payload.method === "resources/read") {
            return jsonResponse({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    contents: [
                        {
                            uri: payload.params?.uri,
                            mimeType: "text/plain",
                            text: "remote notes",
                        },
                    ],
                },
            });
        }
        if (payload.method === "prompts/get") {
            const args = payload.params?.arguments as { topic?: unknown } | undefined;
            return jsonResponse({
                jsonrpc: "2.0",
                id: payload.id,
                result: {
                    description: "Remote review prompt",
                    messages: [{ role: "user", content: { type: "text", text: `Review ${String(args?.topic ?? "")}` } }],
                },
            });
        }
        if (payload.method === "tools/call") {
            const args = payload.params?.arguments as { text?: unknown } | undefined;
            return jsonResponse({
                jsonrpc: "2.0",
                id: payload.id,
                result: { isError: false, content: [{ type: "text", text: String(args?.text ?? "") }] },
            });
        }
        return jsonResponse({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method not found" } });
    }, fn);
}

async function withControllableHttpMcpServer<T>(
    fn: (url: string, control: { failToolsList: boolean }) => Promise<T>,
): Promise<T> {
    const control = { failToolsList: false };
    let transportToken = "";
    return withMockHttpMcpEndpoint(
        "controllable",
        async (request) => {
            const payload = (await request.json()) as {
                id?: number | string;
                method?: string;
                params?: Record<string, unknown>;
            };
            if (payload.method === "initialize") {
                transportToken = crypto.randomUUID();
                return jsonResponse(
                    { jsonrpc: "2.0", id: payload.id, result: { capabilities: {} } },
                    { [MCP_TRANSPORT_TOKEN_RESPONSE_HEADER]: transportToken },
                );
            }
            if (payload.method === "notifications/initialized") {
                return new Response(null, { status: 202 });
            }
            if (request.headers.get(MCP_TRANSPORT_TOKEN_HEADER) !== transportToken) {
                return jsonResponse({ jsonrpc: "2.0", id: payload.id, error: { code: -32001, message: "missing transport token" } });
            }
            if (payload.method === "tools/list") {
                if (control.failToolsList) return new Response("catalog unavailable", { status: 503 });
                return jsonResponse({ jsonrpc: "2.0", id: payload.id, result: { tools: [httpEchoTool()] } });
            }
            if (payload.method === "tools/call") {
                const args = payload.params?.arguments as { text?: unknown } | undefined;
                return jsonResponse({
                    jsonrpc: "2.0",
                    id: payload.id,
                    result: { isError: false, content: [{ type: "text", text: String(args?.text ?? "") }] },
                });
            }
            return jsonResponse({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "method not found" } });
        },
        (url) => fn(url, control),
    );
}

async function withMockHttpMcpEndpoint<T>(
    name: string,
    handler: (request: Request) => Promise<Response>,
    fn: (url: string) => Promise<T>,
): Promise<T> {
    const url = `https://mcp.test/${name}`;
    const originalFetch = globalThis.fetch;
    // HTTP MCP behavior is validated at the fetch boundary so tests do not depend on
    // local TCP listen support in constrained Bun sandboxes.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (String(input) !== url) return originalFetch(input, init);
        return handler(input instanceof Request ? input : new Request(String(input), init));
    }) as typeof fetch;
    try {
        return await fn(url);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json", ...headers },
    });
}

function httpEchoTool(): { description: string; inputSchema: { properties: { text: { type: string } }; type: string }; name: string } {
    return {
        name: "echo",
        description: "Echo input text",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
    };
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

async function installTestPluginCapability(paths: FlyflorPaths): Promise<void> {
    await mkdir(paths.projectPluginDir, { recursive: true });
    await writeFile(join(paths.projectPluginDir, "echo.plugin.js"), pluginCapabilityScript());
    await writeFile(
        join(paths.projectPluginDir, "plugins.json"),
        JSON.stringify({
            plugins: {
                demo: {
                    entry: "./echo.plugin.js",
                    capabilities: {
                        echo: {
                            description: "Echo plugin input",
                            inputSchema: {
                                type: "object",
                                properties: { text: { type: "string" } },
                                required: ["text"],
                            },
                            permission: ToolPermission.Execute,
                            scope: [ToolScope.Local],
                            category: ToolCategory.System,
                            readOnly: false,
                            concurrencySafe: false,
                            exclusive: true,
                        },
                    },
                },
            },
        }),
    );
}

async function initGitRepo(root: string): Promise<void> {
    await writeFile(join(root, "tracked.txt"), "initial\n");
    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "test@example.com"]);
    await runGit(root, ["config", "user.name", "Test User"]);
    await runGit(root, ["add", "tracked.txt"]);
    await runGit(root, ["commit", "-m", "initial"]);
}

async function runGit(cwd: string, args: string[]): Promise<void> {
    const child = Bun.spawn({
        cmd: ["git", ...args],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${stdout}${stderr}`);
    }
}

async function copyTemplateGroup(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(
        entries
            .filter((entry) => entry.isFile())
            .map((entry) => copyFile(join(source, entry.name), join(destination, entry.name))),
    );
}

function gatewayMessage(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        route: {
            channel: Channel.Stdio,
            conversationKey: "test-chat",
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
    public readonly messages: ModelMessage[][] = [];
    private index = 0;

    public constructor(private readonly responses: string[]) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
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
    public readonly messages: ModelMessage[][] = [];

    public constructor(private readonly chunks: string[]) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.chunks.join("");
    }

    public async *stream(messages: ModelMessage[]): AsyncIterable<string> {
        this.messages.push(messages);
        for (const chunk of this.chunks) {
            yield chunk;
        }
    }
}

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

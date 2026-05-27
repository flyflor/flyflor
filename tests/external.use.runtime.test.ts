import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    GitToolset,
    ProcessToolset,
    RuntimeMcpToolExecutor,
    RuntimeMcpToolPlanComponent,
    USER_TOOL_SERVER,
    WorkspaceToolset,
    type RuntimeUserToolCatalogEntry,
} from "../src/agent/runtime/mcp/index.ts";
import { SandboxQuotaTracker } from "../src/agent/sandbox/index.ts";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { externalToolManifestPath, loadExternalTools, type ExternalToolDefinition } from "../src/executive/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import {
    Channel,
    SandboxMode,
    ToolApprovalMode,
    ToolHiddenReason,
    ToolPermission,
    type RuntimeEvent,
} from "../src/protocol/contracts/index.ts";

const APP_ROOT = new URL("../", import.meta.url).pathname;

describe("opt-in browser.use and computer.use runtime closure", () => {
    test("executes explicitly exposed high-level use tools through process-json sidecars", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-external-use-runtime-"));
        const paths = testPaths(root);
        const sink = new CapturingSink();
        try {
            await writeOptInManifest(paths);
            const externalTools = await loadExternalTools(paths);
            const localPlan = new RuntimeMcpToolPlanComponent().buildCapabilities({
                channel: Channel.Stdio,
                externalTools,
                maxPermission: ToolPermission.Computer,
                projectScoped: true,
                tools: [],
            });
            const remotePlan = new RuntimeMcpToolPlanComponent().buildCapabilities({
                channel: Channel.Telegram,
                externalTools,
                maxPermission: ToolPermission.Computer,
                projectScoped: false,
                tools: [],
            });

            expect(localPlan.externalTools.map((entry) => entry.tool.descriptor.name)).toEqual([
                "browser.use",
                "computer.use",
            ]);
            expect(remotePlan.externalTools).toEqual([]);
            expect(hiddenReasons(remotePlan.hiddenCapabilities, "browser.use")).toContain(ToolHiddenReason.ScopeMismatch);
            expect(hiddenReasons(remotePlan.hiddenCapabilities, "computer.use")).toContain(ToolHiddenReason.ScopeMismatch);

            const config = await loadConfigForPaths(paths);
            const userToolCatalog = userCatalogFromExternal(localPlan.externalTools);
            const catalog = userToolCatalog.map((entry) => entry.catalog);
            const executor = new RuntimeMcpToolExecutor(
                {
                    ...config,
                    sandbox: {
                        mode: SandboxMode.Yolo,
                        computerApproval: ToolApprovalMode.Allow,
                        pluginApproval: ToolApprovalMode.Allow,
                    },
                },
                sink,
                new SandboxQuotaTracker(),
            );
            const executions = await executor.executeCalls(
                [
                    {
                        server: USER_TOOL_SERVER,
                        tool: "browser.use",
                        input: { action: "open", url: "https://example.test/", captureAfter: true },
                    },
                    {
                        server: USER_TOOL_SERVER,
                        tool: "computer.use",
                        input: { action: "click", element: 3, captureAfter: true },
                    },
                ],
                {
                    catalog,
                    gitToolset: new GitToolset(paths),
                    pluginCapabilityCatalog: [],
                    processToolset: new ProcessToolset(paths),
                    requiresApproval: false,
                    requestId: "req-external-use-runtime",
                    userToolCatalog,
                    workspaceToolset: new WorkspaceToolset(paths),
                },
            );

            expect(executions.map((entry) => ({ ok: entry.ok, key: `${entry.call.server}.${entry.call.tool}` }))).toEqual([
                { key: "user.browser.use", ok: true },
                { key: "user.computer.use", ok: true },
            ]);
            expect(rawResponse(executions[0])).toMatchObject({
                ok: true,
                action: "open",
                backend: "delegate",
                result: {
                    response: {
                        ok: true,
                        mock: true,
                        request: {
                            action: "open",
                            input: {
                                action: "open",
                                captureAfter: true,
                                url: "https://example.test/",
                            },
                        },
                    },
                },
                captureAfter: {
                    action: "snapshot",
                    backend: "delegate",
                    readOnly: true,
                },
            });
            expect(rawResponse(executions[1])).toMatchObject({
                ok: true,
                action: "click",
                backend: "delegate",
                readOnly: false,
                result: {
                    response: {
                        ok: true,
                        mock: true,
                        request: {
                            action: "click",
                            input: {
                                action: "click",
                                captureAfter: true,
                                element: 3,
                            },
                        },
                    },
                },
                captureAfter: {
                    action: "capture",
                    readOnly: true,
                },
            });
            expect(sink.types.filter((type) => type === RuntimeEventType.PluginInvokeStart)).toHaveLength(2);
            expect(sink.types.filter((type) => type === RuntimeEventType.PluginInvokeEnd)).toHaveLength(2);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

async function writeOptInManifest(paths: FlyflorPaths): Promise<void> {
    await mkdir(paths.projectToolDir!, { recursive: true });
    await writeFile(
        externalToolManifestPath(paths),
        JSON.stringify({
            schemaVersion: 2,
            sidecars: {
                "browser.use": {
                    command: "bun",
                    args: ["scripts/browser.use.sidecar.ts"],
                    cwd: "app",
                    config: {
                        backend: "delegate",
                        delegateCommand: "bun",
                        delegateArgs: ["scripts/mock.sidecar.ts"],
                    },
                    tools: ["browser.use"],
                },
                "computer.use": {
                    command: "bun",
                    args: ["scripts/computer.use.sidecar.ts"],
                    cwd: "app",
                    config: {
                        backend: "delegate",
                        delegateCommand: "bun",
                        delegateArgs: ["scripts/mock.sidecar.ts"],
                    },
                    tools: ["computer.use"],
                },
            },
        }),
    );
}

function userCatalogFromExternal(externalTools: readonly ExternalToolDefinition[]): RuntimeUserToolCatalogEntry[] {
    return externalTools.map((entry) => ({
        catalog: {
            server: USER_TOOL_SERVER,
            tool: {
                name: entry.tool.descriptor.name,
                description: entry.tool.descriptor.description,
                inputSchema: entry.tool.descriptor.inputSchema,
            },
        },
        tool: entry.tool,
    }));
}

function rawResponse(execution: { result?: { raw?: unknown } } | undefined): unknown {
    const raw = execution?.result?.raw;
    if (!raw || typeof raw !== "object") return undefined;
    return (raw as { response?: unknown }).response;
}

function hiddenReasons(hidden: readonly { name: string; reasons: readonly string[] }[], name: string): string[] {
    return hidden.filter((entry) => entry.name === name).flatMap((entry) => [...entry.reasons]);
}

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }

    public get types(): string[] {
        return this.events.map((event) => event.type);
    }
}

function testPaths(root: string): FlyflorPaths {
    return {
        appRoot: APP_ROOT,
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        home: join(root, "home"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        mcpDir: join(root, "mcp"),
        pluginDir: join(root, "plugins"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectKitDir: join(root, "project", ".flyflor", "kits"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectToolDir: join(root, "project", "tools"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        storageDir: join(root, "storage"),
        templateDir: join(root, "templates"),
        toolDir: join(root, "config", "tools"),
        workspaceDir: join(root, "workspace"),
    };
}

import { describe, expect, test } from "bun:test";
import {
    Channel,
    ToolHiddenReason,
    ToolPermission,
    ToolCategory,
    ToolScope,
} from "../src/protocol/contracts/index.ts";
import { RuntimeMcpToolPlanComponent } from "../src/agent/runtime/mcp/index.ts";
import type { McpToolCatalogEntry, McpToolDefinition } from "../src/agent/mcp/index.ts";

describe("RuntimeMcpToolPlanComponent", () => {
    test("keeps workspace and local tools hidden from remote channels without workspace scope", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("workspace", "read"), entry("shell", "run")],
            channel: Channel.Telegram,
        });

        expect(plan.catalog).toEqual([]);
        expect(hiddenReasons(plan, "workspace.read")).toContain(ToolHiddenReason.ScopeMismatch);
        expect(hiddenReasons(plan, "shell.run")).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch, ToolHiddenReason.PermissionCap]),
        );
    });

    test("exposes workspace read tools for local workspace turns", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("workspace", "read"), entry("git", "status"), entry("shell", "run")],
            channel: Channel.Stdio,
            projectScoped: true,
        });

        expect(plan.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual([
            "workspace.read",
            "git.status",
        ]);
        expect(hiddenReasons(plan, "shell.run")).toContain(ToolHiddenReason.PermissionCap);
    });

    test("treats websocket control as a local project surface for TUI execution", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("workspace", "read"), entry("workspace", "write"), entry("workspace", "patch"), entry("shell", "run")],
            channel: Channel.Ws,
            maxPermission: ToolPermission.Write,
            projectScoped: true,
        });

        expect(plan.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual([
            "workspace.read",
            "workspace.write",
            "workspace.patch",
        ]);
        expect(hiddenReasons(plan, "shell.run")).toContain(ToolHiddenReason.PermissionCap);
    });

    test("exposes local shell when sandbox has granted execute capability", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("shell", "run")],
            channel: Channel.Stdio,
            maxPermission: ToolPermission.Execute,
            projectScoped: true,
        });

        expect(plan.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual(["shell.run"]);
        expect(plan.hiddenTools).toEqual([]);
    });

    test("keeps computer-control tools hidden from remote turns and exposes them on local computer-capable surface", () => {
        const remote = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("computer", "click")],
            channel: Channel.Telegram,
            maxPermission: ToolPermission.Computer,
        });
        const local = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("computer", "click")],
            channel: Channel.Stdio,
            maxPermission: ToolPermission.Computer,
            projectScoped: true,
        });

        expect(remote.catalog).toEqual([]);
        expect(hiddenReasons(remote, "computer.click")).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch]),
        );
        expect(local.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual(["computer.click"]);
        expect(local.hiddenTools).toEqual([]);
    });

    test("plans MCP resources and prompts as read-only capabilities", () => {
        const plan = new RuntimeMcpToolPlanComponent().buildCapabilities({
            channel: Channel.Stdio,
            projectScoped: true,
            resources: [
                {
                    server: "docs",
                    resource: {
                        uri: "file://README.md",
                        name: "readme",
                        mimeType: "text/markdown",
                    },
                },
            ],
            prompts: [
                {
                    server: "prompts",
                    prompt: {
                        name: "review",
                        description: "Review prompt",
                    },
                },
            ],
            tools: [entry("workspace", "read")],
        });

        expect(plan.tools.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual(["workspace.read"]);
        expect(plan.resources.map((resource) => `${resource.server}:${resource.resource.uri}`)).toEqual([
            "docs:file://README.md",
        ]);
        expect(plan.prompts.map((prompt) => `${prompt.server}.${prompt.prompt.name}`)).toEqual(["prompts.review"]);
        expect(plan.hiddenCapabilities).toEqual([]);
    });

    test("plans plugin manifest capabilities through the same Executive visibility gate", () => {
        const plan = new RuntimeMcpToolPlanComponent().buildCapabilities({
            channel: Channel.Stdio,
            pluginCapabilities: [
                {
                    entry: "./inspector.ts",
                    enabled: true,
                    plugin: "inspector",
                    source: "project",
                    descriptor: {
                        category: ToolCategory.Coding,
                        concurrencySafe: true,
                        description: "Scan symbols",
                        exclusive: false,
                        inputSchema: { type: "object" },
                        name: "plugin.inspector.symbols.scan",
                        permission: ToolPermission.Read,
                        readOnly: true,
                        resultLimit: { maxChars: 4000 },
                        scope: [ToolScope.Workspace],
                        source: "plugin",
                    },
                },
            ],
            projectScoped: true,
            tools: [],
        });

        expect(plan.pluginCapabilities.map((entry) => entry.descriptor.name)).toEqual([
            "plugin.inspector.symbols.scan",
        ]);
        expect(plan.hiddenCapabilities).toEqual([]);
    });
});

function entry(server: string, name: string): McpToolCatalogEntry {
    return {
        server,
        tool: {
            name,
            description: `${server}.${name}`,
            inputSchema: { type: "object" },
        } satisfies McpToolDefinition,
    };
}

function hiddenReasons(plan: ReturnType<RuntimeMcpToolPlanComponent["build"]>, name: string): string[] {
    return plan.hiddenTools.filter((tool) => tool.name === name).flatMap((tool) => [...tool.reasons]);
}

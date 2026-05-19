import { describe, expect, test } from "bun:test";
import {
    Channel,
    CttlHiddenReason,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
} from "../src/protocol/contracts/index.ts";
import { RuntimeMcpToolPlanComponent } from "../src/agent/runtime/mcp/index.ts";
import type { McpToolCatalogEntry, McpToolDefinition } from "../src/agent/mcp/index.ts";

describe("RuntimeMcpToolPlanComponent", () => {
    test("keeps project and local tools hidden from remote channels without project scope", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("workspace", "read"), entry("shell", "run")],
            channel: Channel.Telegram,
        });

        expect(plan.catalog).toEqual([]);
        expect(hiddenReasons(plan, "workspace.read")).toContain(CttlHiddenReason.ScopeMismatch);
        expect(hiddenReasons(plan, "shell.run")).toEqual(
            expect.arrayContaining([CttlHiddenReason.ScopeMismatch, CttlHiddenReason.PermissionCap]),
        );
    });

    test("exposes project read tools for local project turns", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("workspace", "read"), entry("git", "status"), entry("shell", "run")],
            channel: Channel.Stdio,
            projectScoped: true,
        });

        expect(plan.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual([
            "workspace.read",
            "git.status",
        ]);
        expect(hiddenReasons(plan, "shell.run")).toContain(CttlHiddenReason.PermissionCap);
    });

    test("exposes local shell when sandbox has granted execute capability", () => {
        const plan = new RuntimeMcpToolPlanComponent().build({
            catalog: [entry("shell", "run")],
            channel: Channel.Stdio,
            maxPermission: CttlPermission.Execute,
            projectScoped: true,
        });

        expect(plan.catalog.map((tool) => `${tool.server}.${tool.tool.name}`)).toEqual(["shell.run"]);
        expect(plan.hiddenTools).toEqual([]);
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

    test("plans plugin manifest capabilities through the same CTTL visibility gate", () => {
        const plan = new RuntimeMcpToolPlanComponent().buildCapabilities({
            channel: Channel.Stdio,
            pluginCapabilities: [
                {
                    entry: "./inspector.ts",
                    enabled: true,
                    plugin: "inspector",
                    source: "project",
                    descriptor: {
                        category: CttlToolCategory.Coding,
                        concurrencySafe: true,
                        description: "Scan symbols",
                        exclusive: false,
                        inputSchema: { type: "object" },
                        name: "plugin.inspector.symbols.scan",
                        permission: CttlPermission.Read,
                        readOnly: true,
                        resultLimit: { maxChars: 4000 },
                        scope: [CttlToolScope.Project],
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

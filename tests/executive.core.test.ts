import { describe, expect, test } from "bun:test";
import {
    CapabilitySource,
    ToolHiddenReason,
    ExecutiveLoopGuardReason,
    ToolPermission,
    ToolCategory,
    ToolScope,
    TrustSurface,
} from "../src/protocol/contracts/index.ts";
import { ArchitectureLayer, Component, readComponentMetadata } from "../src/agent/di/index.ts";
import {
    ExecutiveComponent,
    ExecutiveLoopGuard,
    McpCatalogAdapter,
    ToolRegistry,
    isPermissionAllowed,
    type ToolDescriptor,
} from "../src/executive/index.ts";

describe("Executive core", () => {
    test("registers tools and rejects duplicate names", () => {
        const registry = new ToolRegistry();
        registry.register(tool("workspace.read"));

        expect(registry.has("workspace.read")).toBe(true);
        expect(() => registry.register(tool("workspace.read"))).toThrow("already registered");
    });

    test("builds a visible and hidden tool plan from trust context", () => {
        const executive = new ExecutiveComponent();
        executive.registerTool(tool("workspace.read", { permission: ToolPermission.Read, scope: [ToolScope.Workspace] }));
        executive.registerTool(tool("shell.run", { permission: ToolPermission.Execute, scope: [ToolScope.Local] }));
        executive.registerTool(
            tool("message.send", {
                category: ToolCategory.Message,
                permission: ToolPermission.Message,
                scope: [ToolScope.Channel],
                source: CapabilitySource.Channel,
            }),
        );

        const plan = executive.buildToolPlan({
            allowedScopes: new Set([ToolScope.Workspace, ToolScope.Channel]),
            allowedSources: new Set([CapabilitySource.Core, CapabilitySource.Channel]),
            maxPermission: ToolPermission.Message,
        });

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["message.send", "workspace.read"]);
        expect(plan.hidden).toHaveLength(1);
        expect(plan.hidden[0]?.descriptor.name).toBe("shell.run");
        expect(plan.hidden[0]?.diagnostics.map((item) => item.reason)).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch, ToolHiddenReason.PermissionCap]),
        );
    });

    test("permission caps are explicit and ordered", () => {
        expect(isPermissionAllowed(ToolPermission.Read, ToolPermission.Write)).toBe(true);
        expect(isPermissionAllowed(ToolPermission.Execute, ToolPermission.Message)).toBe(false);
        expect(isPermissionAllowed(ToolPermission.Dangerous, ToolPermission.Computer)).toBe(false);
    });

    test("trust policy keeps remote channels away from local execution tools", () => {
        const executive = new ExecutiveComponent();
        executive.registerTool(tool("message.send", {
            category: ToolCategory.Message,
            permission: ToolPermission.Message,
            scope: [ToolScope.Channel],
            source: CapabilitySource.Channel,
        }));
        executive.registerTool(tool("shell.run", {
            category: ToolCategory.System,
            permission: ToolPermission.Execute,
            scope: [ToolScope.Local],
        }));
        executive.registerTool(tool("mouse.click", {
            category: ToolCategory.Computer,
            permission: ToolPermission.Computer,
            scope: [ToolScope.Local],
        }));

        const plan = executive.buildToolPlan(executive.buildTrustContext({ surface: TrustSurface.Channel }));

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["message.send"]);
        expect(hiddenReasons(plan, "shell.run")).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch, ToolHiddenReason.PermissionCap]),
        );
        expect(hiddenReasons(plan, "mouse.click")).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch, ToolHiddenReason.PermissionCap]),
        );
    });

    test("trust policy enables workspace read/write tools for local workspace work", () => {
        const executive = new ExecutiveComponent();
        executive.registerTool(tool("workspace.read", {
            permission: ToolPermission.Read,
            scope: [ToolScope.Workspace],
        }));
        executive.registerTool(tool("workspace.write", {
            permission: ToolPermission.Write,
            readOnly: false,
            scope: [ToolScope.Workspace],
        }));
        executive.registerTool(tool("network.search", {
            category: ToolCategory.Network,
            permission: ToolPermission.Network,
            scope: [ToolScope.Workspace],
        }));

        const plan = executive.buildToolPlan(executive.buildTrustContext({ projectScoped: true, surface: TrustSurface.Local }));

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["workspace.read", "workspace.write"]);
        expect(hiddenReasons(plan, "network.search")).toContain(ToolHiddenReason.PermissionCap);
    });

    test("trust policy only exposes dangerous tools in local debug context", () => {
        const executive = new ExecutiveComponent();
        executive.registerTool(tool("browser.control", {
            category: ToolCategory.Computer,
            concurrencySafe: false,
            exclusive: true,
            permission: ToolPermission.Dangerous,
            readOnly: false,
            scope: [ToolScope.Debug],
        }));

        const regular = executive.buildToolPlan(executive.buildTrustContext({ surface: TrustSurface.Local }));
        const debug = executive.buildToolPlan(executive.buildTrustContext({ debug: true, surface: TrustSurface.Local }));

        expect(regular.visible).toHaveLength(0);
        expect(hiddenReasons(regular, "browser.control")).toEqual(
            expect.arrayContaining([ToolHiddenReason.ScopeMismatch, ToolHiddenReason.PermissionCap]),
        );
        expect(debug.visible.map((entry) => entry.descriptor.name)).toEqual(["browser.control"]);
    });

    test("computer-control tools require computer permission and remain hidden from default local trust", () => {
        const executive = new ExecutiveComponent();
        executive.registerTool(tool("computer.click", {
            category: ToolCategory.Computer,
            concurrencySafe: false,
            exclusive: true,
            permission: ToolPermission.Computer,
            readOnly: false,
            scope: [ToolScope.Local, ToolScope.Debug],
            computer: {
                action: "mouse",
                observationOnly: false,
                requiresFocusTarget: true,
            },
        }));

        const local = executive.buildToolPlan(executive.buildTrustContext({ surface: TrustSurface.Local }));
        const localComputer = executive.buildToolPlan(executive.buildTrustContext({
            maxPermission: ToolPermission.Computer,
            surface: TrustSurface.Local,
        }));
        const debug = executive.buildToolPlan(executive.buildTrustContext({
            debug: true,
            maxPermission: ToolPermission.Computer,
            surface: TrustSurface.Local,
        }));

        expect(local.visible).toHaveLength(0);
        expect(hiddenReasons(local, "computer.click")).toContain(ToolHiddenReason.PermissionCap);
        expect(localComputer.visible.map((entry) => entry.descriptor.name)).toEqual(["computer.click"]);
        expect(debug.visible.map((entry) => entry.descriptor.name)).toEqual(["computer.click"]);
    });

    test("MCP catalog adapter maps builtin and remote tools into Executive descriptors", () => {
        const adapter = new McpCatalogAdapter();
        const workspace = adapter.descriptorFor(mcpEntry("workspace", "read"));
        const workspacePatch = adapter.descriptorFor(mcpEntry("workspace", "patch"));
        const shell = adapter.descriptorFor(mcpEntry("shell", "run"));
        const remote = adapter.descriptorFor(mcpEntry("browser", "open"));
        const computer = adapter.descriptorFor(mcpEntry("computer", "click"));
        const resource = adapter.resourceDescriptorFor({
            server: "docs",
            resource: {
                uri: "file://README.md",
                name: "readme",
                mimeType: "text/markdown",
            },
        });
        const prompt = adapter.promptDescriptorFor({
            server: "prompts",
            prompt: {
                name: "code-review",
                description: "Review code",
            },
        });

        expect(workspace).toMatchObject({
            category: ToolCategory.Coding,
            name: "workspace.read",
            permission: ToolPermission.Read,
            readOnly: true,
            scope: [ToolScope.Workspace],
            source: CapabilitySource.Core,
        });
        expect(workspacePatch).toMatchObject({
            category: ToolCategory.Coding,
            name: "workspace.patch",
            permission: ToolPermission.Write,
            readOnly: false,
            scope: [ToolScope.Workspace],
            source: CapabilitySource.Core,
        });
        expect(shell).toMatchObject({
            category: ToolCategory.System,
            concurrencySafe: false,
            exclusive: true,
            name: "shell.run",
            permission: ToolPermission.Execute,
            readOnly: false,
            scope: [ToolScope.Local],
            source: CapabilitySource.Core,
        });
        expect(remote).toMatchObject({
            category: ToolCategory.Integration,
            name: "browser.open",
            permission: ToolPermission.Network,
            scope: [ToolScope.Core],
            source: CapabilitySource.Mcp,
        });
        expect(computer).toMatchObject({
            category: ToolCategory.Computer,
            name: "computer.click",
            permission: ToolPermission.Computer,
            scope: [ToolScope.Local, ToolScope.Debug],
            source: CapabilitySource.Mcp,
            computer: {
                action: "browser",
                observationOnly: false,
                requiresFocusTarget: true,
            },
        });
        expect(resource).toMatchObject({
            name: "docs.resource.file.readme.md",
            permission: ToolPermission.Read,
            readOnly: true,
            source: CapabilitySource.Mcp,
            sourceId: "file://README.md",
            tags: ["mcp-resource", "text/markdown"],
        });
        expect(prompt).toMatchObject({
            name: "prompts.prompt.code-review",
            permission: ToolPermission.Read,
            readOnly: true,
            source: CapabilitySource.Mcp,
            sourceId: "code-review",
            tags: ["mcp-prompt"],
        });
    });

    test("loop guard stops repeated unknown tools", () => {
        const guard = new ExecutiveLoopGuard({ maxUnknownToolRepeats: 1 });
        const knownToolNames = new Set(["workspace.read"]);

        expect(guard.inspect({ knownToolNames, toolName: "missing.tool" }).allow).toBe(true);
        const blocked = guard.inspect({ knownToolNames, toolName: "missing.tool" });

        expect(blocked).toMatchObject({
            allow: false,
            reason: ExecutiveLoopGuardReason.UnknownToolRepeat,
        });
        expect(guard.snapshot().unknownToolCounts["missing.tool"]).toBe(2);
    });

    test("loop guard stops repeated failed calls with stable argument ordering", () => {
        const guard = new ExecutiveLoopGuard({ maxFailedCallRepeats: 1, maxRepeatedCalls: 10 });

        expect(guard.inspect({ input: { b: 2, a: 1 }, ok: false, toolName: "shell.run" }).allow).toBe(true);
        const blocked = guard.inspect({ input: { a: 1, b: 2 }, ok: false, toolName: "shell.run" });

        expect(blocked).toMatchObject({
            allow: false,
            reason: ExecutiveLoopGuardReason.FailedCallRepeat,
        });
    });

    test("Executive component is a capability-layer component", () => {
        const metadata = readComponentMetadata(DecoratedExecutiveComponent);

        expect(metadata).toMatchObject({
            layer: ArchitectureLayer.Capability,
            name: "executive",
        });
    });
});

@Component("executive")
class DecoratedExecutiveComponent extends ExecutiveComponent {}

function tool(name: string, overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
    return {
        category: ToolCategory.System,
        concurrencySafe: true,
        description: `${name} test tool`,
        exclusive: false,
        inputSchema: { type: "object" },
        name,
        permission: ToolPermission.Read,
        readOnly: true,
        resultLimit: { maxChars: 4_000 },
        scope: [ToolScope.Core],
        source: CapabilitySource.Core,
        ...overrides,
    };
}

function mcpEntry(server: string, name: string) {
    return {
        server,
        tool: {
            description: `${server}.${name}`,
            inputSchema: { type: "object" },
            name,
        },
    };
}

function hiddenReasons(plan: ReturnType<ExecutiveComponent["buildToolPlan"]>, name: string): ToolHiddenReason[] {
    return plan.hidden
        .filter((entry) => entry.descriptor.name === name)
        .flatMap((entry) => entry.diagnostics.map((diagnostic) => diagnostic.reason));
}

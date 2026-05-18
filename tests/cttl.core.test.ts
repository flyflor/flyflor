import { describe, expect, test } from "bun:test";
import {
    CttlCapabilitySource,
    CttlHiddenReason,
    CttlLoopGuardReason,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
} from "../src/protocol/contracts/index.ts";
import { ArchitectureLayer, Component, readComponentMetadata } from "../src/agent/di/index.ts";
import { CttlComponent, CttlLoopGuard, CttlToolRegistry, isPermissionAllowed, type CttlToolDescriptor } from "../src/cttl/index.ts";

describe("CTTL core", () => {
    test("registers tools and rejects duplicate names", () => {
        const registry = new CttlToolRegistry();
        registry.register(tool("workspace.read"));

        expect(registry.has("workspace.read")).toBe(true);
        expect(() => registry.register(tool("workspace.read"))).toThrow("already registered");
    });

    test("builds a visible and hidden tool plan from trust context", () => {
        const cttl = new CttlComponent();
        cttl.registerTool(tool("workspace.read", { permission: CttlPermission.Read, scope: [CttlToolScope.Project] }));
        cttl.registerTool(tool("shell.run", { permission: CttlPermission.Execute, scope: [CttlToolScope.Local] }));
        cttl.registerTool(
            tool("message.send", {
                category: CttlToolCategory.Message,
                permission: CttlPermission.Message,
                scope: [CttlToolScope.Channel],
                source: CttlCapabilitySource.Channel,
            }),
        );

        const plan = cttl.buildToolPlan({
            allowedScopes: new Set([CttlToolScope.Project, CttlToolScope.Channel]),
            allowedSources: new Set([CttlCapabilitySource.Core, CttlCapabilitySource.Channel]),
            maxPermission: CttlPermission.Message,
        });

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["message.send", "workspace.read"]);
        expect(plan.hidden).toHaveLength(1);
        expect(plan.hidden[0]?.descriptor.name).toBe("shell.run");
        expect(plan.hidden[0]?.diagnostics.map((item) => item.reason)).toEqual(
            expect.arrayContaining([CttlHiddenReason.ScopeMismatch, CttlHiddenReason.PermissionCap]),
        );
    });

    test("permission caps are explicit and ordered", () => {
        expect(isPermissionAllowed(CttlPermission.Read, CttlPermission.Write)).toBe(true);
        expect(isPermissionAllowed(CttlPermission.Execute, CttlPermission.Message)).toBe(false);
        expect(isPermissionAllowed(CttlPermission.Dangerous, CttlPermission.Computer)).toBe(false);
    });

    test("trust policy keeps remote channels away from local execution tools", () => {
        const cttl = new CttlComponent();
        cttl.registerTool(tool("message.send", {
            category: CttlToolCategory.Message,
            permission: CttlPermission.Message,
            scope: [CttlToolScope.Channel],
            source: CttlCapabilitySource.Channel,
        }));
        cttl.registerTool(tool("shell.run", {
            category: CttlToolCategory.System,
            permission: CttlPermission.Execute,
            scope: [CttlToolScope.Local],
        }));
        cttl.registerTool(tool("mouse.click", {
            category: CttlToolCategory.Computer,
            permission: CttlPermission.Computer,
            scope: [CttlToolScope.Local],
        }));

        const plan = cttl.buildToolPlan(cttl.buildTrustContext({ surface: "channel" }));

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["message.send"]);
        expect(hiddenReasons(plan, "shell.run")).toEqual(
            expect.arrayContaining([CttlHiddenReason.ScopeMismatch, CttlHiddenReason.PermissionCap]),
        );
        expect(hiddenReasons(plan, "mouse.click")).toEqual(
            expect.arrayContaining([CttlHiddenReason.ScopeMismatch, CttlHiddenReason.PermissionCap]),
        );
    });

    test("trust policy enables project read/write tools for local project work", () => {
        const cttl = new CttlComponent();
        cttl.registerTool(tool("workspace.read", {
            permission: CttlPermission.Read,
            scope: [CttlToolScope.Project],
        }));
        cttl.registerTool(tool("workspace.write", {
            permission: CttlPermission.Write,
            readOnly: false,
            scope: [CttlToolScope.Project],
        }));
        cttl.registerTool(tool("network.search", {
            category: CttlToolCategory.Network,
            permission: CttlPermission.Network,
            scope: [CttlToolScope.Project],
        }));

        const plan = cttl.buildToolPlan(cttl.buildTrustContext({ projectScoped: true, surface: "local" }));

        expect(plan.visible.map((entry) => entry.descriptor.name)).toEqual(["workspace.read", "workspace.write"]);
        expect(hiddenReasons(plan, "network.search")).toContain(CttlHiddenReason.PermissionCap);
    });

    test("trust policy only exposes dangerous tools in local debug context", () => {
        const cttl = new CttlComponent();
        cttl.registerTool(tool("browser.control", {
            category: CttlToolCategory.Computer,
            concurrencySafe: false,
            exclusive: true,
            permission: CttlPermission.Dangerous,
            readOnly: false,
            scope: [CttlToolScope.Debug],
        }));

        const regular = cttl.buildToolPlan(cttl.buildTrustContext({ surface: "local" }));
        const debug = cttl.buildToolPlan(cttl.buildTrustContext({ debug: true, surface: "local" }));

        expect(regular.visible).toHaveLength(0);
        expect(hiddenReasons(regular, "browser.control")).toEqual(
            expect.arrayContaining([CttlHiddenReason.ScopeMismatch, CttlHiddenReason.PermissionCap]),
        );
        expect(debug.visible.map((entry) => entry.descriptor.name)).toEqual(["browser.control"]);
    });

    test("loop guard stops repeated unknown tools", () => {
        const guard = new CttlLoopGuard({ maxUnknownToolRepeats: 1 });
        const knownToolNames = new Set(["workspace.read"]);

        expect(guard.inspect({ knownToolNames, toolName: "missing.tool" }).allow).toBe(true);
        const blocked = guard.inspect({ knownToolNames, toolName: "missing.tool" });

        expect(blocked).toMatchObject({
            allow: false,
            reason: CttlLoopGuardReason.UnknownToolRepeat,
        });
        expect(guard.snapshot().unknownToolCounts["missing.tool"]).toBe(2);
    });

    test("loop guard stops repeated failed calls with stable argument ordering", () => {
        const guard = new CttlLoopGuard({ maxFailedCallRepeats: 1, maxRepeatedCalls: 10 });

        expect(guard.inspect({ input: { b: 2, a: 1 }, ok: false, toolName: "shell.run" }).allow).toBe(true);
        const blocked = guard.inspect({ input: { a: 1, b: 2 }, ok: false, toolName: "shell.run" });

        expect(blocked).toMatchObject({
            allow: false,
            reason: CttlLoopGuardReason.FailedCallRepeat,
        });
    });

    test("CTTL component is a capability-layer component", () => {
        const metadata = readComponentMetadata(DecoratedCttlComponent);

        expect(metadata).toMatchObject({
            layer: ArchitectureLayer.Capability,
            name: "cttl",
        });
    });
});

@Component("cttl")
class DecoratedCttlComponent extends CttlComponent {}

function tool(name: string, overrides: Partial<CttlToolDescriptor> = {}): CttlToolDescriptor {
    return {
        category: CttlToolCategory.System,
        concurrencySafe: true,
        description: `${name} test tool`,
        exclusive: false,
        inputSchema: { type: "object" },
        name,
        permission: CttlPermission.Read,
        readOnly: true,
        resultLimit: { maxChars: 4_000 },
        scope: [CttlToolScope.Core],
        source: CttlCapabilitySource.Core,
        ...overrides,
    };
}

function hiddenReasons(plan: ReturnType<CttlComponent["buildToolPlan"]>, name: string): CttlHiddenReason[] {
    return plan.hidden
        .filter((entry) => entry.descriptor.name === name)
        .flatMap((entry) => entry.diagnostics.map((diagnostic) => diagnostic.reason));
}

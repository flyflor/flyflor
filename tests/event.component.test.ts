import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeSkillUsageEventHandler } from "../src/agent/runtime/events/index.ts";
import { Event } from "../src/agent/di/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import { classifyRuntimeEvent, EventsComponent, NullEventSink, RuntimeEventType, RuntimeEventBus } from "../src/events/index.ts";
import { loadSkillUsageSummary } from "../src/agent/skills/index.ts";
import { RuntimeEventClass, type RuntimeEvent } from "../src/protocol/contracts/index.ts";

class RecordingHook {
    public readonly seen: string[] = [];

    @Event(RuntimeEventType.AgentTurnStart)
    public onAgentTurnStart(event: RuntimeEvent): void {
        this.seen.push(event.type);
    }
}

class WildcardHook {
    public count = 0;

    @Event("*")
    public onAnyEvent(): void {
        this.count += 1;
    }
}

describe("EventsComponent explicit hooks", () => {
    test("emit publishes to typed subscribers through the global bus surface", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const seen: string[] = [];

        const dispose = events.on(RuntimeEventType.AgentTurnStart, (event) => {
            seen.push(event.type);
        });
        events.emit(RuntimeEventType.AgentTurnStart, { request: "a" }, "req-1");
        dispose();
        events.emit(RuntimeEventType.AgentTurnStart, { request: "b" }, "req-2");

        expect(seen).toEqual([RuntimeEventType.AgentTurnStart]);
    });

    test("@Event metadata is registered only when the instance is explicitly hooked", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const hook = new RecordingHook();
        const wildcard = new WildcardHook();

        const disposers = [...events.registerHooks(hook), ...events.registerHooks(wildcard)];
        events.emit(RuntimeEventType.AgentTurnStart);
        events.emit(RuntimeEventType.AgentTurnEnd);
        for (const dispose of disposers) {
            dispose();
        }
        events.emit(RuntimeEventType.AgentTurnStart);

        expect(hook.seen).toEqual([RuntimeEventType.AgentTurnStart]);
        expect(wildcard.count).toBe(2);
    });

    test("hook failures do not interrupt later subscribers", () => {
        const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
        const seen: string[] = [];

        events.on(RuntimeEventType.AgentTurnStart, () => {
            throw new Error("hook failed");
        });
        events.on(RuntimeEventType.AgentTurnStart, (event) => {
            seen.push(event.type);
        });

        events.emit(RuntimeEventType.AgentTurnStart);

        expect(seen).toEqual([RuntimeEventType.AgentTurnStart]);
    });

    test("CTTL loop guard events are classified as effects", () => {
        expect(classifyRuntimeEvent(RuntimeEventType.CttlCapabilityCatalogBuilt)).toBe(RuntimeEventClass.Read);
        expect(classifyRuntimeEvent(RuntimeEventType.CttlLoopGuardBlocked)).toBe(RuntimeEventClass.Effect);
        expect(classifyRuntimeEvent(RuntimeEventType.McpCapabilityCatalogBuilt)).toBe(RuntimeEventClass.Read);
    });

    test("runtime skill usage handler records sidecar usage from structured events", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-events-"));
        try {
            const paths = testPaths(root);
            const events = new EventsComponent(new NullEventSink(), new RuntimeEventBus());
            const disposers = events.registerHooks(new RuntimeSkillUsageEventHandler({ paths }));

            events.emit(
                RuntimeEventType.SkillContextBuilt,
                {
                    selected: [
                        {
                            name: "shipper",
                            source: "project",
                            compatibility: ["flyflor"],
                            capabilities: ["deploy"],
                        },
                    ],
                },
                "req-skill",
            );
            events.emit(RuntimeEventType.McpToolCallExecuted, { ok: true }, "req-skill");
            events.emit(RuntimeEventType.McpToolCallExecuted, { ok: false }, "req-skill");
            events.emit(RuntimeEventType.AgentTurnEnd, {}, "req-skill");
            await events.flush();
            for (const dispose of disposers) {
                dispose();
            }

            const summary = await loadSkillUsageSummary(paths);
            expect(summary.skills.shipper).toMatchObject({
                capabilities: ["deploy"],
                mcpCallCount: 2,
                mcpSuccessCount: 1,
                source: "project",
                useCount: 1,
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

function testPaths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "storage"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
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

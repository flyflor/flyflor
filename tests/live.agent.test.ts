/**
 * Live agent smoke.
 *
 * This opt-in suite reuses the user's real model provider config while keeping
 * all runtime state in a temporary Flyflor home. It validates the deploy path
 * that matters most for inner testing: model -> runtime -> memory -> brain.db.
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { createModelClient } from "../src/llm/index.ts";
import { MemoryModule } from "../src/neural/memory/index.ts";
import {
    loadConfig,
    loadConfigForPaths,
    type FlyflorConfig,
    type FlyflorPaths,
} from "../src/config/index.ts";
import { Channel, ChatType, type GatewayMessage, type RuntimeContext } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

interface LiveAgentReport {
    brainEvents: number;
    eventTypes: string[];
    replyChars: number;
    skipped?: boolean;
    tempHome: string;
    turnRecords: number;
}

describe("live agent runtime", () => {
    test("runs a real configured model through runtime + memory in an isolated home", async () => {
        const report = await new LiveAgentHarness().run();
        if (report.skipped) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }

        expect(report.replyChars).toBeGreaterThan(0);
        expect(report.brainEvents).toBeGreaterThanOrEqual(1);
        expect(report.turnRecords).toBeGreaterThanOrEqual(1);
        expect(report.eventTypes).toContain(RuntimeEventType.AgentTurnStart);
        expect(report.eventTypes).toContain(RuntimeEventType.AgentTurnEnd);
        expect(report.eventTypes).toContain(RuntimeEventType.MemoryEpisodeWritten);
        expect(report.eventTypes).toContain(RuntimeEventType.MemoryTurnRecorded);
    }, 120_000);
});

class LiveAgentHarness {
    private root = "";
    private runtime: RuntimeModule | undefined;

    public async run(): Promise<LiveAgentReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-live-agent-smoke-"));
        try {
            const config = await this.createIsolatedConfig();
            if (!this.hasLiveApiKey(config)) {
                return {
                    brainEvents: 0,
                    eventTypes: [],
                    replyChars: 0,
                    skipped: true,
                    tempHome: config.paths.home,
                    turnRecords: 0,
                };
            }
            const events = new RecordingSink();
            const memory = new MemoryModule(config, events);
            this.runtime = new RuntimeModule(config, createModelClient(config.model), events, undefined, memory);

            const reply = await this.runtime.handleMessage(this.message(), this.context());
            const report = this.inspectBrain(config, events, reply.text);
            console.log(JSON.stringify(report, null, 2));
            return report;
        } finally {
            this.runtime?.dispose();
            await rm(this.root, { force: true, recursive: true });
        }
    }

    private async createIsolatedConfig(): Promise<FlyflorConfig> {
        const liveConfig = await loadConfig();
        const paths = this.paths();
        const repoRoot = resolve(import.meta.dir, "..");
        await mkdir(dirname(paths.promptDir), { recursive: true });
        await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
        await mkdir(dirname(paths.templateDir), { recursive: true });
        await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");

        const isolatedConfig = await loadConfigForPaths(paths);
        // Only the provider profile comes from the user's real config. Runtime,
        // memory, logs, cache and brain.db stay under the temporary smoke home.
        isolatedConfig.model = liveConfig.model;
        return isolatedConfig;
    }

    private hasLiveApiKey(config: FlyflorConfig): boolean {
        return typeof config.model.apiKey === "string" && config.model.apiKey.trim().length > 0;
    }

    private paths(): FlyflorPaths {
        const home = join(this.root, "home");
        const project = join(this.root, "workspace");
        return {
            home,
            configDir: home,
            storageDir: join(home, "storage"),
            cacheDir: join(home, "cache"),
            workspaceDir: project,
            logDir: join(home, "logs"),
            memoryDir: join(project, ".flyflor", "memory"),
            projectDir: project,
            projectFlyflorDir: join(project, ".flyflor"),
            projectMemoryDir: join(project, ".flyflor", "memory"),
            projectSkillDir: join(project, ".flyflor", "skills"),
            projectMcpDir: join(project, ".flyflor", "mcp"),
            projectPluginDir: join(project, ".flyflor", "plugins"),
            pluginDir: join(home, "plugins"),
            promptDir: join(home, "prompts"),
            skillDir: join(home, "skills"),
            templateDir: join(home, "templates"),
            mcpDir: join(home, "mcp"),
        };
    }

    private message(): GatewayMessage {
        return {
            id: "live-agent-smoke-message",
            receivedAt: new Date().toISOString(),
            text: "Run a concise Flyflor live agent smoke. Reply in one short sentence and do not use tools.",
            attachments: [],
            user: { id: "live-smoke-user", displayName: "Live Smoke User" },
            route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "live-agent-smoke" },
        };
    }

    private context(): RuntimeContext {
        return {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
            embedding: [],
        };
    }

    private inspectBrain(config: FlyflorConfig, events: RecordingSink, replyText: string): LiveAgentReport {
        const db = new Database(join(config.paths.home, "brain.db"), { readonly: true });
        try {
            return {
                brainEvents: this.count(db, "memory_events"),
                eventTypes: events.types,
                replyChars: replyText.trim().length,
                tempHome: config.paths.home,
                turnRecords: this.count(db, "memory_turns"),
            };
        } finally {
            db.close();
        }
    }

    private count(db: Database, table: string): number {
        const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        return row.count;
    }
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ type: string }> = [];

    public get types(): string[] {
        return this.events.map((item) => item.type);
    }

    public publish(event: { type: string }): void {
        this.events.push({ type: event.type });
    }
}

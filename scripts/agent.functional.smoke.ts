import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    Channel,
    ChatType,
    MemoryActionTarget,
    SceneRecordKind,
    TaskPlanStatus,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { renderStructuredBlock, StructuredBlockProtocol } from "../src/protocol/index.ts";

interface FunctionalSmokeReport {
    brainEvents: number;
    contextForks: number;
    eventTypes: string[];
    ok: boolean;
    replyText: string;
    sceneRecords: number;
    taskPlans: number;
    tempHome: string;
}

/**
 * Deterministic end-to-end agent smoke.
 *
 * This probes the intelligence hot path without real provider cost: runtime
 * warmup, model-visible protocol parsing, memory action persistence, planning
 * metadata, brain.db writes, history replay records, and event emission.
 */
class AgentFunctionalSmoke {
    private runtime: RuntimeModule | undefined;
    private memory: MemoryModule | undefined;
    private root = "";

    public async run(): Promise<FunctionalSmokeReport> {
        this.root = await mkdtemp(join(tmpdir(), "flyflor-agent-functional-smoke-"));
        try {
            const config = await this.createConfig();
            const events = new RecordingSink();
            this.memory = new MemoryModule(config, events);
            this.runtime = new RuntimeModule(config, new ScriptedAgentModel(), events, undefined, this.memory);
            const reply = await this.runtime.handleMessage(this.message(), this.context());
            const report = this.inspectBrain(config, events, reply.text);
            console.log(JSON.stringify(report, null, 2));
            if (!report.ok) {
                process.exitCode = 1;
            }
            return report;
        } finally {
            this.runtime?.dispose();
            await rm(this.root, { force: true, recursive: true });
        }
    }

    private async createConfig(): Promise<FlyflorConfig> {
        const paths = this.paths();
        const repoRoot = resolve(import.meta.dir, "..");
        await mkdir(dirname(paths.promptDir), { recursive: true });
        await symlink(join(repoRoot, "templates", "prompts"), paths.promptDir, "dir");
        await mkdir(dirname(paths.templateDir), { recursive: true });
        await symlink(join(repoRoot, "templates"), paths.templateDir, "dir");
        return await loadConfigForPaths(paths);
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
            id: "agent-functional-smoke-message",
            receivedAt: "2026-05-17T00:00:00.000Z",
            text: "Run the deterministic agent functional smoke.",
            attachments: [],
            user: { id: "smoke-user", displayName: "Smoke User" },
            route: { channel: Channel.Stdio, chatType: ChatType.Direct, chatId: "agent-functional-smoke" },
        };
    }

    private context(): RuntimeContext {
        return {
            requestId: "agent-functional-smoke-request",
            now: "2026-05-17T00:00:00.000Z",
            embedding: [],
        };
    }

    private inspectBrain(config: FlyflorConfig, events: RecordingSink, replyText: string): FunctionalSmokeReport {
        const db = new Database(join(config.paths.configDir, "brain.db"), { readonly: true });
        try {
            const brainEvents = this.count(db, "memory_events");
            const taskPlans = this.count(db, "task_plans");
            const contextForks = this.count(db, "context_forks");
            const sceneRecords = this.count(db, "scene_records");
            const requiredEvents = [
                RuntimeEventType.AgentTurnStart,
                RuntimeEventType.AgentTurnEnd,
                RuntimeEventType.MemoryBrainEventWritten,
                RuntimeEventType.MemoryTaskPlanWritten,
                RuntimeEventType.MemoryContextForkWritten,
                RuntimeEventType.MemorySceneRecordWritten,
            ];
            const eventTypes = events.types;
            return {
                brainEvents,
                contextForks,
                eventTypes,
                ok:
                    brainEvents >= 1 &&
                    taskPlans === 1 &&
                    contextForks === 1 &&
                    sceneRecords === 1 &&
                    requiredEvents.every((type) => eventTypes.includes(type)) &&
                    !replyText.includes("flyflor_"),
                replyText,
                sceneRecords,
                taskPlans,
                tempHome: config.paths.home,
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

class ScriptedAgentModel implements ModelClient {
    public async generate(_messages: ModelMessage[]): Promise<string> {
        return [
            "Agent functional smoke completed.",
            renderStructuredBlock(StructuredBlockProtocol.MemoryActions, {
                actions: [
                    {
                        action: "add",
                        target: MemoryActionTarget.Memory,
                        content: "Agent functional smoke persisted memory and planning metadata.",
                        confidence: 0.98,
                        signals: {
                            durability: 1,
                            recurrence: 1,
                            sourceDiversity: 1,
                            validationCount: 1,
                        },
                    },
                ],
            }),
            renderStructuredBlock(StructuredBlockProtocol.TaskPlan, {
                title: "Agent functional smoke plan",
                summary: "Verify runtime reply, memory write, planning metadata, and history records.",
                status: TaskPlanStatus.InProgress,
                progress: 0.5,
                steps: [
                    { id: "reply", title: "Generate visible reply", status: TaskPlanStatus.Done, order: 0 },
                    { id: "memory", title: "Persist memory event", status: TaskPlanStatus.InProgress, order: 1 },
                ],
            }),
            renderStructuredBlock(StructuredBlockProtocol.ContextFork, {
                title: "Smoke fork",
                summary: "Bound the deterministic smoke context.",
                scopeSummary: "Only the generated smoke turn and planning records are inherited.",
                maxContextTokens: 4096,
                inheritedEventIds: [],
            }),
            renderStructuredBlock(StructuredBlockProtocol.SceneRecord, {
                kind: SceneRecordKind.DeepThink,
                title: "Smoke scene",
                summary: "Runtime parsed structured planning without leaking protocol text.",
                visibleFacts: ["reply generated", "memory persisted"],
                openQuestions: [],
            }),
        ].join("\n");
    }
}

class RecordingSink implements EventSink {
    public readonly events: Array<{ payload?: Record<string, unknown>; type: string }> = [];

    public get types(): string[] {
        return this.events.map((item) => item.type);
    }

    public publish(input: ReturnType<typeof event>): void {
        this.events.push(input);
    }
}

if (import.meta.main) {
    await new AgentFunctionalSmoke().run();
}

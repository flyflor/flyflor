import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildBypassDecision,
    evaluateFastRoute,
    FastRouteReason,
    type FastRouteSnapshot,
} from "../src/agent/runtime/routing/index.ts";
import type { FastRouteSnapshotStore } from "../src/agent/runtime/routing/index.ts";
import { PerfMetrics } from "../src/agent/runtime/perf.metrics.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { LocalHashEmbeddingProvider } from "../src/cognitive/hippocampus/embedding/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import {
    BlackboardMode,
    BlackboardTurnStatus,
    Channel,
    ChatType,
    type GatewayMessage,
    type GatewayReply,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { loadConfigForPaths, type FlyflorConfig } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push({ type: evt.type, payload: evt.payload });
    }
    public countOf(type: string): number {
        return this.events.filter((e) => e.type === type).length;
    }
    public findOf(type: string): { type: string; payload?: Record<string, unknown> } | undefined {
        return this.events.find((e) => e.type === type);
    }
}

describe("fastRoute resource-only short-circuit", () => {
    const baseConfig = {
        fastRouteEnabled: true,
        routeHintTtlMs: 5_000,
        similarityBypassThreshold: 0.85,
        routeBypassTokenBudget: 32,
    };

    test("returns disabled when fastRouteEnabled is false", () => {
        const result = evaluateFastRoute({
            config: { ...baseConfig, fastRouteEnabled: false },
            nowMs: 0,
            messageChars: 4,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.Disabled);
    });

    test("bypasses by token budget on short messages", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            nowMs: 0,
            messageChars: 16,
        });
        expect(result.bypass).toBe(true);
        expect(result.reason).toBe(FastRouteReason.BypassByBudget);
        expect(result.metrics?.estimatedTokens).toBe(4);
    });

    test("returns no-snapshot when nothing recorded yet (and message above budget)", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            nowMs: 1_000,
            messageChars: 1024,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.NoSnapshot);
    });

    test("bypasses by hint when previous turn promised direct and TTL is fresh", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                nextRouteHint: BlackboardMode.Direct,
                recordedAt: 1_000,
                lastMode: BlackboardMode.Direct,
            },
            nowMs: 2_000,
            messageChars: 1024,
        });
        expect(result.bypass).toBe(true);
        expect(result.reason).toBe(FastRouteReason.BypassByHint);
    });

    test("hint expires after TTL", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                nextRouteHint: BlackboardMode.Direct,
                recordedAt: 0,
                lastMode: BlackboardMode.Direct,
            },
            nowMs: 10_000,
            messageChars: 1024,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.HintExpired);
    });

    test("similar embedding to previous direct turn bypasses LLM route", () => {
        const embed = [0.6, 0.6, 0.5, 0.1];
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                recordedAt: 0,
                embedding: embed,
                lastMode: BlackboardMode.Direct,
            },
            nowMs: 100_000,
            currentEmbedding: [0.62, 0.59, 0.51, 0.1],
            messageChars: 1024,
        });
        expect(result.bypass).toBe(true);
        expect(result.reason).toBe(FastRouteReason.BypassBySimilarity);
        expect(result.metrics?.similarity ?? 0).toBeGreaterThan(0.85);
    });

    test("dissimilar embedding does not bypass and reports similarity-below-threshold", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                recordedAt: 0,
                embedding: [1, 0, 0, 0],
                lastMode: BlackboardMode.Direct,
            },
            nowMs: 100_000,
            currentEmbedding: [0, 1, 0, 0],
            messageChars: 1024,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.SimilarityBelowThreshold);
    });

    test("hint that explicitly demands non-direct surfaces hint-not-direct", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                nextRouteHint: BlackboardMode.Blackboard,
                recordedAt: 0,
                lastMode: BlackboardMode.Blackboard,
            },
            nowMs: 100,
            messageChars: 1024,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.HintNotDirect);
    });

    test("buildBypassDecision yields a direct decision with fastroute reason tag", () => {
        const decision = buildBypassDecision(FastRouteReason.BypassByBudget);
        expect(decision.mode).toBe(BlackboardMode.Direct);
        expect(decision.reason).toBe("fastroute:bypass-by-budget");
        expect(decision.workers).toEqual([]);
        expect(decision.blackboardContract.policyReason).toBe("fastroute-bypass");
    });

    test("cosine similarity returns 0 when vectors have mismatched length", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            snapshot: {
                recordedAt: 0,
                embedding: [1, 0, 0],
                lastMode: BlackboardMode.Direct,
            },
            nowMs: 100,
            currentEmbedding: [0.99, 0.01],
            messageChars: 1024,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.SimilarityBelowThreshold);
        expect(result.metrics?.similarity).toBe(0);
    });
});

describe("PerfMetrics event emission", () => {
    test("mark/measure publishes event with elapsedMs when enabled", async () => {
        const events = new CapturingSink();
        const perf = new PerfMetrics({ enabled: true }, events);
        const done = perf.mark(RuntimeEventType.PerfTtfb, { channel: "stdio" }, "req-1");
        await new Promise((r) => setTimeout(r, 5));
        done({ extraField: "x" });
        const e = events.findOf(RuntimeEventType.PerfTtfb)!;
        expect(e.payload?.channel).toBe("stdio");
        expect(e.payload?.extraField).toBe("x");
        expect((e.payload?.elapsedMs as number) >= 0).toBe(true);
    });

    test("disabled metrics produce zero events", () => {
        const events = new CapturingSink();
        const perf = new PerfMetrics({ enabled: false }, events);
        const done = perf.mark(RuntimeEventType.PerfBuildPrompt);
        done();
        perf.record(RuntimeEventType.PerfFastRouteEvaluated, { latencyMs: 1 });
        expect(events.events.length).toBe(0);
    });

    test("record bypasses mark and emits a single event", () => {
        const events = new CapturingSink();
        const perf = new PerfMetrics({ enabled: true }, events);
        perf.record(RuntimeEventType.PerfFastRouteEvaluated, { bypass: true, reason: "x" }, "req-2");
        expect(events.countOf(RuntimeEventType.PerfFastRouteEvaluated)).toBe(1);
    });
});

describe("Runtime fastRoute cache observability", () => {
    test("cache write failure degrades to telemetry without failing the reply", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const runtime = new RuntimeModule(config, new StaticTextModel("fast route reply"), events);
        (
            runtime as unknown as {
                fastRouteSnapshots: FastRouteSnapshotStore;
            }
        ).fastRouteSnapshots = new FailingFastRouteSnapshotStore();

        const reply = await runtime.handleMessage(
            msg("short turn"),
            withEmbedding(await embedFor(config, "short turn")),
        );

        expect(reply.text).toBe("fast route reply");
        const failure = events.findOf(RuntimeEventType.PerfFastRouteCacheFailed);
        expect(failure?.payload).toMatchObject({
            channel: Channel.Stdio,
            error: "fast-route-cache-down",
        });
    });

    test("post-reply async failures publish events without downgrading the final reply", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const runtime = new RuntimeModule(config, new StaticTextModel("reply survives async failure"), events, undefined, memory);
        const instrumentedRuntime = runtime as unknown as {
            memory: MemoryModule & {
                classifyAndApplyFeedback: (_message: GatewayMessage, _context: RuntimeContext) => Promise<void>;
                recordDebateEpisode: (_input: {
                    embedding?: number[];
                    requestId?: string;
                    text: string;
                    sourceKey: string;
                }) => Promise<void>;
            };
            dispatchAsyncTurnTasks: (
                message: GatewayMessage,
                prepared: {
                    context: RuntimeContext;
                    embedding: number[];
                    enrichedContext: RuntimeContext;
                },
                assembled: { blackboardRun?: { status?: BlackboardTurnStatus; steps: Array<{ blockers: string[]; newFacts: string[]; outputSummary: string; workerRole: string }>; mode: BlackboardMode; reason: string; metadata: Record<string, unknown>; decisions: unknown[] } },
                generated: {
                    mcpCallProvenance: [];
                    selectedSkillNames: string[];
                    visibleText: string;
                },
            ) => Promise<void>;
        };
        instrumentedRuntime.memory.classifyAndApplyFeedback = async () => {
            throw new Error("feedback-dispatch-failed");
        };
        instrumentedRuntime.memory.recordDebateEpisode = async () => {
            throw new Error("debate-episode-failed");
        };

        const reply = await runtime.handleMessage(
            msg("async failure turn"),
            withEmbedding(await embedFor(config, "async failure turn")),
        );
        expect(reply.text).toBe("reply survives async failure");

        await instrumentedRuntime.dispatchAsyncTurnTasks(
            msg("debate failure turn"),
            {
                context: withEmbedding(await embedFor(config, "debate failure turn")),
                embedding: await embedFor(config, "debate failure turn"),
                enrichedContext: withEmbedding(await embedFor(config, "debate failure turn")),
            },
            {
                blackboardRun: {
                    decisions: [],
                    metadata: {},
                    mode: BlackboardMode.Blackboard,
                    reason: "converged",
                    status: BlackboardTurnStatus.Converged,
                    steps: [{ blockers: [], newFacts: ["fact"], outputSummary: "summary", workerRole: "analyst" }],
                },
            },
            {
                mcpCallProvenance: [],
                selectedSkillNames: [],
                visibleText: "visible",
            },
        );

        expect(events.findOf(RuntimeEventType.MemoryFeedbackFailed)?.payload).toMatchObject({
            error: "feedback-dispatch-failed",
            stage: "runtime-dispatch",
        });
        expect(events.events.some((entry) =>
            entry.type === RuntimeEventType.MemoryReflectionFailed &&
            typeof entry.payload === "object" &&
            entry.payload !== null &&
            (entry.payload as Record<string, unknown>).stage === "runtime-debate-episode" &&
            (entry.payload as Record<string, unknown>).error === "debate-episode-failed"
        )).toBe(true);
        runtime.dispose();
    });
});

describe("Memory module warmup, embedding reuse, episode capture", () => {
    test("warmup opens the default local working memory when non-local backend is disabled", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const warmup = events.findOf(RuntimeEventType.MemoryWarmupComplete);
        expect(events.countOf(RuntimeEventType.MemoryWarmupComplete)).toBe(1);
        expect(warmup?.payload?.backend).toBe("local");
        expect(warmup?.payload?.workingMemoryHealth).toMatchObject({
            backend: "local",
            loaded: true,
        });
    });

    test("rememberTurn writes episode to local working memory when non-local backend is disabled", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const message = msg("hello world");
        const reply = rep("hi");
        const ctx = withEmbedding(await embedFor(config, "hello world"));
        const result = await memory.rememberTurn(message, reply, ctx);
        expect(result.candidates).toHaveLength(0);
        expect(events.countOf(RuntimeEventType.MemoryEpisodeWritten)).toBe(1);
        expect(events.countOf(RuntimeEventType.MemoryBrainEventWritten)).toBe(1);
    });

    test("rememberTurn writes structured memory actions as brain atoms", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const ctx = withEmbedding(await embedFor(config, "brain atom"));
        await memory.rememberTurn(msg("brain atom"), rep("stored"), ctx, [
            {
                action: "add",
                target: "memory",
                content: "Brain atoms are driven by structured memory actions.",
                confidence: 0.9,
                signals: {
                    durability: 0.9,
                    relevance: 0.9,
                },
            },
        ]);

        const brain = memory as unknown as {
            brain: {
                listPromptAtomsWindow(
                    date: Date | string,
                    input: { minScore: number; sourceKey: string },
                ): Array<{
                    atom: { text: string };
                    score: { total: number };
                }>;
            };
        };
        const visible = brain.brain.listPromptAtomsWindow(ctx.now, { minScore: 0.1, sourceKey: "u1" });
        expect(visible.map((entry) => entry.atom.text)).toContain(
            "Brain atoms are driven by structured memory actions.",
        );
        expect(visible[0]?.score.total).toBeGreaterThan(0);
    });

    test("hippocampus context reads brain atoms without sidecar memory files", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        await memory.warmup();
        const ctx = withEmbedding(await embedFor(config, "brain-backed hippocampus"));
        await memory.rememberTurn(msg("brain-backed hippocampus"), rep("stored"), ctx, [
            {
                action: "add",
                target: "memory",
                content: "Hippocampus recall must survive sidecar cleanup.",
                confidence: 0.95,
                signals: {
                    durability: 0.95,
                    relevance: 0.95,
                },
            },
        ]);
        // Simulate removing an old sidecar directory: hippocampus context must come from brain.db.
        await rm(join(config.paths.home, "journal"), { recursive: true, force: true });

        const prompt = await memory.buildPrompt(msg("brain-backed hippocampus follow-up"), {
            ...ctx,
            requestId: crypto.randomUUID(),
            embedding: await embedFor(config, "brain-backed hippocampus"),
        });

        expect(prompt).toContain("Recent Activated Memory");
        expect(prompt).toContain("Hippocampus recall must survive sidecar cleanup.");
        memory.dispose();
    });

    test("buildPrompt keeps brain prompt atoms out of prompt assembly", async () => {
        const config = await buildConfig();
        config.memory.candidates.autoPromoteExplicit = false;
        config.memory.tuning.atomScore.visibilityThreshold = 0.65;
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const ctx = withEmbedding(await embedFor(config, "atom visibility"));

        await memory.rememberTurn(msg("atom visibility low"), rep("stored"), ctx, [
            {
                action: "add",
                target: "memory",
                content: "low atom must stay hidden from prompt",
                confidence: 0.05,
                signals: {
                    durability: 0,
                    recurrence: 0,
                    sourceDiversity: 0,
                    validationCount: 0,
                },
            },
        ]);
        await memory.rememberTurn(
            msg("atom visibility high"),
            rep("stored"),
            { ...ctx, requestId: crypto.randomUUID(), now: "2026-05-09T02:01:00.000Z" },
            [
                {
                    action: "add",
                    target: "memory",
                    content: "high atom passes visibility gate",
                    confidence: 0.95,
                    signals: {
                        durability: 1,
                        recurrence: 1,
                        sourceDiversity: 1,
                        validationCount: 1,
                    },
                },
            ],
        );

        const prompt = await memory.buildPrompt(msg("atom visibility"), ctx);

        expect(prompt).toContain("Recent Activated Memory");
        expect(prompt).not.toContain("high atom passes visibility gate");
        expect(prompt).not.toContain("low atom must stay hidden from prompt");
        const promptBuilt = events.findOf(RuntimeEventType.MemoryPromptBuilt);
        expect(promptBuilt?.payload?.brainPromptRecallResults).toBe(0);
        memory.dispose();
    });

    test("buildPrompt does not call brain prompt recall", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        await memory.warmup();
        const brain = memory as unknown as { brain: { listPromptAtomsWindow: () => never } };
        brain.brain.listPromptAtomsWindow = () => {
            throw new Error("broken brain prompt recall");
        };
        const ctx = withEmbedding(await embedFor(config, "broken journal"));
        const prompt = await memory.buildPrompt(msg("broken journal"), ctx);
        expect(prompt).toContain("Recent Activated Memory");
        memory.dispose();
    });

    test("buildPrompt accepts optional context parameter without throwing", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        const ctx = withEmbedding(await embedFor(config, "hello"));
        const out = await memory.buildPrompt(msg("hello"), ctx);
        expect(typeof out).toBe("string");
        expect(out.length).toBeGreaterThan(0);
    });

    test("applyReflection short-circuits when no candidates supplied", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.applyReflection([], { requestId: "r", now: "t" });
        expect(events.countOf(RuntimeEventType.MemoryReflectionFailed)).toBe(0);
    });

    test("rememberTurn pipeline runs candidate writes and history consolidation in parallel", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        const message = msg("hello world");
        const reply = rep("hi");
        const ctx = withEmbedding(await embedFor(config, "hello world"));
        const start = performance.now();
        const out = await memory.rememberTurn(message, reply, ctx, []);
        const elapsed = performance.now() - start;
        expect(out.candidates).toHaveLength(0);
        expect(elapsed).toBeLessThan(1500);
    });

    test("recordDebateEpisode writes to local working memory when non-local backend is disabled", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.recordDebateEpisode({
            ownerKey: "scope:u1",
            sourceKey: "u1",
            text: "[debate-goal] x\n[analyst] something",
            embedding: await embedFor(config, "x"),
            requestId: "r1",
        });
        expect(events.countOf(RuntimeEventType.MemoryEpisodeWritten)).toBe(1);
        expect(events.countOf(RuntimeEventType.MemoryReflectionFailed)).toBe(0);
    });
});

// ─── helpers ──────────────────────────────────────────────────────

async function buildConfig(): Promise<FlyflorConfig> {
    const home = await mkdtemp(join(tmpdir(), "flyflor-perf-"));
    const paths = {
        home,
        configDir: home,
        storageDir: join(home, "storage"),
        cacheDir: join(home, "cache"),
        projectDir: join(home, "project"),
        projectFlyflorDir: join(home, "project", ".flyflor"),
        projectSkillDir: join(home, "project", ".flyflor", "skills"),
        projectMcpDir: join(home, "project", ".flyflor", "mcp"),
        projectPluginDir: join(home, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(home, "project", ".flyflor", "memory"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(home, "memory"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
    };
    await mkdir(paths.promptDir, { recursive: true });
    await mkdir(join(paths.templateDir, "memory"), { recursive: true });
    await mkdir(join(paths.templateDir, "projects"), { recursive: true });
    const promptSrc = join(import.meta.dir, "..", "templates", "prompts");
    const memSrc = join(import.meta.dir, "..", "templates", "memory");
    const projectSrc = join(import.meta.dir, "..", "templates", "projects");
    for (const [src, dst] of [
        [promptSrc, paths.promptDir],
        [memSrc, join(paths.templateDir, "memory")],
        [projectSrc, join(paths.templateDir, "projects")],
    ] as const) {
        const entries = await readdir(src, { withFileTypes: true });
        await Promise.all(entries.filter((e) => e.isFile()).map((e) => copyFile(join(src, e.name), join(dst, e.name))));
    }
    const config = await loadConfigForPaths(paths);
    config.memory.crystal.enabled = false;
    config.memory.markdown.enabled = true;
    await loadPromptTemplates(config.paths);
    return config;
}

async function embedFor(config: FlyflorConfig, text: string): Promise<number[]> {
    const p = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
    return await p.embed(text);
}

function withEmbedding(embedding: number[]): RuntimeContext {
    return { requestId: crypto.randomUUID(), now: "2026-05-09T02:00:00.000Z", embedding, contextForkId: "test-fork" };
}

function msg(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        route: { channel: Channel.Stdio, conversationKey: "c1", chatType: ChatType.Direct, threadId: "t1" },
        user: { id: "u1" },
        text,
        receivedAt: "2026-05-09T02:00:00.000Z",
    };
}

function rep(text: string): GatewayReply {
    return { messageId: crypto.randomUUID(), route: msg("").route, text };
}

class StaticTextModel implements ModelClient {
    public constructor(private readonly response: string) {}

    public async generate(_messages: ModelMessage[]): Promise<string> {
        return this.response;
    }
}

class FailingFastRouteSnapshotStore implements FastRouteSnapshotStore {
    public async get(_key: string): Promise<FastRouteSnapshot | undefined> {
        return undefined;
    }

    public async set(_key: string, _snapshot: FastRouteSnapshot): Promise<void> {
        throw new Error("fast-route-cache-down");
    }
}

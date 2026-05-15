import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBypassDecision, evaluateFastRoute, FastRouteReason } from "../src/agent/runtime/fast.route.ts";
import { PerfMetrics } from "../src/agent/runtime/perf.metrics.ts";
import { LocalHashEmbeddingProvider } from "../src/neural/memory/embedding.ts";
import { JournalStore, MemoryModule } from "../src/neural/memory/index.ts";
import {
    BlackboardMode,
    Channel,
    ChatType,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import { loadConfigForPaths, type FlyflorConfig } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";

class CapturingSink implements EventSink {
    readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push({ type: evt.type, payload: evt.payload });
    }
    countOf(type: string): number {
        return this.events.filter((e) => e.type === type).length;
    }
    findOf(type: string): { type: string; payload?: Record<string, unknown> } | undefined {
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
        perf.record(RuntimeEventType.PerfRedisLatency, { latencyMs: 1 });
        expect(events.events.length).toBe(0);
    });

    test("record bypasses mark and emits a single event", () => {
        const events = new CapturingSink();
        const perf = new PerfMetrics({ enabled: true }, events);
        perf.record(RuntimeEventType.PerfFastRouteEvaluated, { bypass: true, reason: "x" }, "req-2");
        expect(events.countOf(RuntimeEventType.PerfFastRouteEvaluated)).toBe(1);
    });
});

describe("Memory module warmup, embedding reuse, episode capture", () => {
    test("warmup opens the default local working memory when Redis adapter is disabled", async () => {
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

    test("rememberTurn writes episode to local working memory when Redis adapter is disabled", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const message = msg("hello world");
        const reply = rep("hi");
        const ctx = withEmbedding(await embedFor(config, "hello world"));
        const result = await memory.rememberTurn(message, reply, ctx);
        expect(result.candidates).toHaveLength(0);
        expect(events.countOf(RuntimeEventType.MemoryEpisodeWritten)).toBe(1);
        expect(events.countOf(RuntimeEventType.MemoryJournalWritten)).toBe(1);
        const journalEvent = events.findOf(RuntimeEventType.MemoryJournalWritten);
        expect(await Bun.file(String(journalEvent?.payload?.dbPath)).exists()).toBe(true);
    });

    test("rememberTurn writes structured memory actions as journal atoms", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const ctx = withEmbedding(await embedFor(config, "journal atom"));
        await memory.rememberTurn(msg("journal atom"), rep("stored"), ctx, [
            {
                action: "add",
                target: "memory",
                content: "Journal atoms are driven by structured memory actions.",
                confidence: 0.9,
                signals: {
                    durability: 0.9,
                    relevance: 0.9,
                },
            },
        ]);

        const journal = new JournalStore({ journalRoot: join(config.paths.home, "journal") });
        const visible = await journal.listVisibleAtoms(ctx.now, { minScore: 0.1, userId: "u1" });
        expect(visible.map((entry) => entry.atom.text)).toContain(
            "Journal atoms are driven by structured memory actions.",
        );
        expect(visible[0]?.score.total).toBeGreaterThan(0);
    });

    test("hippocampus context reads brain atoms without legacy journal files", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        await memory.warmup();
        const ctx = withEmbedding(await embedFor(config, "brain-backed hippocampus"));
        await memory.rememberTurn(msg("brain-backed hippocampus"), rep("stored"), ctx, [
            {
                action: "add",
                target: "memory",
                content: "Hippocampus recall must survive legacy journal cleanup.",
                confidence: 0.95,
                signals: {
                    durability: 0.95,
                    relevance: 0.95,
                },
            },
        ]);
        // Simulate removing the legacy audit copy: hippocampus context must come from brain.db.
        await rm(config.paths.journalDir ?? join(config.paths.home, "journal"), { recursive: true, force: true });

        const prompt = await memory.buildPrompt(msg("brain-backed hippocampus follow-up"), {
            ...ctx,
            requestId: crypto.randomUUID(),
            embedding: await embedFor(config, "brain-backed hippocampus"),
        });

        expect(prompt).toContain("Hippocampus context");
        expect(prompt).toContain("Hippocampus recall must survive legacy journal cleanup.");
        memory.dispose();
    });

    test("buildPrompt only exposes brain prompt atoms after the AtomScore visibility gate", async () => {
        const config = await buildConfig();
        config.memory.candidates.autoPromoteExplicit = false;
        config.memory.tuning.atomScore.visibilityThreshold = 0.65;
        const memory = new MemoryModule(config, new CapturingSink());
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

        expect(prompt).toContain("high atom passes visibility gate");
        expect(prompt).not.toContain("low atom must stay hidden from prompt");
    });

    test("buildPrompt propagates brain prompt recall errors instead of silently dropping recall", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        await memory.warmup();
        const brain = memory as unknown as { brain: { listPromptAtomsWindow: () => never } };
        brain.brain.listPromptAtomsWindow = () => {
            throw new Error("broken brain prompt recall");
        };
        const ctx = withEmbedding(await embedFor(config, "broken journal"));
        await expect(memory.buildPrompt(msg("broken journal"), ctx)).rejects.toThrow("broken brain prompt recall");
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

    test("recordDebateEpisode writes to local working memory when Redis adapter is disabled", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.recordDebateEpisode({
            userId: "u1",
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
    return { requestId: crypto.randomUUID(), now: "2026-05-09T02:00:00.000Z", embedding };
}

function msg(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        route: { channel: Channel.Stdio, chatId: "c1", chatType: ChatType.Direct, threadId: "t1" },
        user: { id: "u1" },
        text,
        receivedAt: "2026-05-09T02:00:00.000Z",
    };
}

function rep(text: string): GatewayReply {
    return { messageId: crypto.randomUUID(), route: msg("").route, text };
}

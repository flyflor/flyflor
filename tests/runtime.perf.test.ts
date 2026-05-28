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
import { RuntimeBlackboardRouteComponent } from "../src/agent/runtime/blackboard/index.ts";
import { BlackboardModule, SQLiteBlackboardStore, WorkerManager } from "../src/agent/index.ts";
import { LocalHashEmbeddingProvider } from "../src/cognitive/hippocampus/embedding/index.ts";
import { MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import type { ScopeVectorComponent } from "../src/cognitive/hippocampus/scope/vector/component.ts";
import {
    AskReason,
    BlackboardMode,
    BlackboardTurnStatus,
    BlackboardWorkerOutcome,
    Channel,
    ChatType,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
    type GatewayMessage,
    type GatewayReply,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import { Worker } from "../src/agent/di/index.ts";
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

    test("does not bypass by token budget alone on short messages", () => {
        const result = evaluateFastRoute({
            config: baseConfig,
            nowMs: 0,
            messageChars: 16,
        });
        expect(result.bypass).toBe(false);
        expect(result.reason).toBe(FastRouteReason.NoSnapshot);
        expect(result.metrics?.estimatedTokens).toBe(4);
    });

    test("returns no-snapshot when nothing recorded yet", () => {
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

    test("short formal-definition conflicts still reach the blackboard route model", async () => {
        await buildConfig();
        const model = new RouteJsonModel();
        const runtime = Object.create(RuntimeModule.prototype) as {
            blackboard: object;
            blackboardRoute: RuntimeBlackboardRouteComponent;
            resolveRouteDecision: (message: GatewayMessage, fastRoute: ReturnType<typeof evaluateFastRoute>) => Promise<{
                mode: BlackboardMode;
                blackboardContract: { mode: string };
            } | undefined>;
        };
        runtime.blackboard = {};
        runtime.blackboardRoute = new RuntimeBlackboardRouteComponent();
        (runtime as unknown as { model: ModelClient }).model = model;

        const request = "设计严格几何意义上的正方形的圆，不能近似或比喻，给出精确面积公式。";
        const fastRoute = evaluateFastRoute({
            config: baseConfig,
            nowMs: 0,
            messageChars: request.length,
        });
        expect(fastRoute.bypass).toBe(false);

        const decision = await runtime.resolveRouteDecision(msg(request), fastRoute);

        expect(model.calls).toBe(1);
        expect(decision?.mode).toBe(BlackboardMode.Blackboard);
        expect(decision?.blackboardContract.mode).toBe("non-convergent");
    });

    test("active ASK answer bypasses route model and blackboard escalation", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const workers = new WorkerManager(events);
        workers.register(new RuntimePerfAnalysisWorker());
        workers.register(new RuntimePerfReviewWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new CountingRouteThenReplyModel("answer consumed");
        const runtime = new RuntimeModule(config, model, events, blackboard, memory);

        try {
            const first = await runtime.handleMessage(
                msg("non convergent request"),
                withEmbedding(await embedFor(config, "non convergent request")),
            );
            expect(first.metadata?.kind).toBe("ask");
            expect(first.metadata?.ask).toMatchObject({ reason: AskReason.BlackboardStalemate });
            expect(first.metadata?.blackboard).toMatchObject({ status: BlackboardTurnStatus.NeedsUser });
            expect((first.metadata?.ask as { choices?: unknown[] } | undefined)?.choices?.length ?? 0).toBeGreaterThan(0);

            const second = await runtime.handleMessage(
                msg("choose the first option"),
                withEmbedding(await embedFor(config, "choose the first option")),
            );

            expect(second.metadata?.kind).toBe("reply");
            expect(second.metadata?.blackboard).toMatchObject({
                mode: BlackboardMode.Direct,
                reason: "active-ask-answer",
            });
            expect(second.text).toBe("answer consumed");
            expect(model.routeCalls).toBe(1);
            expect(events.events.filter((entry) => entry.type === RuntimeEventType.BlackboardTurnStart)).toHaveLength(1);
        } finally {
            runtime.dispose();
        }
    });

    test("blackboard discussion is exposed as metadata instead of final reply body", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const workers = new WorkerManager(events);
        workers.register(new RuntimePerfFinalWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new FinalBlackboardRouteThenReplyModel("natural final answer");
        const deltas: string[] = [];
        const runtime = new RuntimeModule(config, model, events, blackboard, memory);

        try {
            const reply = await runtime.handleMessage(
                msg("needs structured blackboard display"),
                withEmbedding(await embedFor(config, "needs structured blackboard display")),
                {
                    onTextDelta: async (delta) => {
                        deltas.push(delta);
                    },
                },
            );

            expect(reply.text).toBe("natural final answer");
            expect(reply.text).not.toContain("perf-final-worker public blackboard transcript");
            expect(deltas.join("")).not.toContain("perf-final-worker public blackboard transcript");
            expect(reply.metadata?.blackboard).toMatchObject({
                mode: BlackboardMode.Blackboard,
                status: BlackboardTurnStatus.Converged,
                rounds: [{
                    round: 1,
                    workers: [{
                        content: "perf-final-worker public blackboard transcript",
                        outputSummary: "perf-final-worker public blackboard transcript",
                        workerRole: "perf-final-worker",
                    }],
                }],
                summary: "perf-final-worker public blackboard transcript",
            });
            expect((reply.metadata?.blackboard as { content?: string } | undefined)?.content).toContain(
                "perf-final-worker public blackboard transcript",
            );
            expect((reply.metadata?.blackboard as { transcript?: Array<{ content: string }> } | undefined)?.transcript?.[0])
                .toMatchObject({ content: "perf-final-worker public blackboard transcript" });
            expect(events.events.filter((entry) => entry.type === RuntimeEventType.BlackboardStarted)).toHaveLength(1);
            expect(events.events.filter((entry) => entry.type === RuntimeEventType.BlackboardRoundStarted)).toHaveLength(1);
            expect(events.events.find((entry) => entry.type === RuntimeEventType.BlackboardWorkerDone)?.payload)
                .toMatchObject({
                    content: "perf-final-worker public blackboard transcript",
                    outputSummary: "perf-final-worker public blackboard transcript",
                    round: 1,
                    workerName: "Final",
                });
            expect(events.events.find((entry) => entry.type === RuntimeEventType.BlackboardCompleted)?.payload)
                .toMatchObject({
                    status: BlackboardTurnStatus.Converged,
                    summary: "perf-final-worker public blackboard transcript",
                });
        } finally {
            runtime.dispose();
        }
    });

    test("direct-with-watch exposes structured thought row without polluting reply text", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, new WorkerManager(events));
        const runtime = new RuntimeModule(
            config,
            new DirectWatchRouteThenReplyModel("clean final answer"),
            events,
            blackboard,
            memory,
        );

        try {
            const reply = await runtime.handleMessage(
                msg("watch this direct path"),
                withEmbedding(await embedFor(config, "watch this direct path")),
            );

            expect(reply.text).toBe("clean final answer");
            expect(reply.text).not.toContain("### 思考中");
            expect(reply.metadata?.thought).toMatchObject({
                route: {
                    mode: BlackboardMode.DirectWithWatch,
                    reason: "test watch route",
                },
                summary: "test watch route",
            });
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.ThoughtStarted);
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.ThoughtDelta);
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.ThoughtCompleted);
        } finally {
            runtime.dispose();
        }
    });

    test("scope recall exposes structured recall metadata and events", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        await memory.warmup();
        const scope = await memory.createOrUseScope({
            path: join(config.paths.workspaceDir, "recall-scope"),
            goal: "socket recall display",
            title: "Recall Scope",
            sourceKey: "test-scope-recall",
        });
        const internals = memory as unknown as { scopeVector: ScopeVectorComponent };
        await internals.scopeVector.recordHotMemory({
            scopeId: scope.id,
            summary: "recall display vector summary",
            text: "recall display evidence",
            symbols: ["recall", "display"],
            importance: 0.9,
            nowMs: Date.now(),
        });
        const runtime = new RuntimeModule(config, new ScopeRecallRouteThenReplyModel(scope.id, "recall final answer"), events, undefined, memory);

        try {
            const reply = await runtime.handleMessage(
                msg("load the recall display scope"),
                withEmbedding(await embedFor(config, "load the recall display scope")),
            );

            expect(reply.text).toBe("recall final answer");
            expect(reply.metadata?.recall).toMatchObject({
                status: "load",
                decision: {
                    kind: "load",
                    scopeId: scope.id,
                },
            });
            expect((reply.metadata?.recall as { markdown?: string } | undefined)?.markdown).toContain("### 回忆中");
            expect(reply.metadata?.memory).toMatchObject({ recall: reply.metadata?.recall });
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.MemoryRecallItem);
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.MemoryRecallAssembled);
            expect(events.events.map((entry) => entry.type)).toContain(RuntimeEventType.MemoryRecallCompleted);
        } finally {
            runtime.dispose();
        }
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

    test("post-reply memory persistence failures publish events without failing the reply", async () => {
        const config = await buildConfig();
        const events = new CapturingSink();
        const memory = {
            warmup: async () => undefined,
            listScopeRecallCandidates: async () => [],
            rememberTurn: async () => {
                throw new Error("memory-write-down");
            },
            recordBehaviorSnapshot: () => null,
            recordContinuationFromReason: () => null,
            listActiveContinuations: () => [],
            peekActiveAsk: () => null,
            buildPrompt: async () => "",
            classifyAndApplyFeedback: async () => undefined,
            recordDebateEpisode: async () => undefined,
            dispose: () => undefined,
        } as unknown as MemoryModule;
        const runtime = new RuntimeModule(config, new StaticTextModel("reply survives memory failure"), events, undefined, memory);

        const reply = await runtime.handleMessage(
            msg("memory failure turn"),
            withEmbedding(await embedFor(config, "memory failure turn")),
        );

        expect(reply.text).toBe("reply survives memory failure");
        expect(events.findOf(RuntimeEventType.MemoryBrainWriteFailed)?.payload).toMatchObject({
            error: "memory-write-down",
            stage: "runtime-persist-turn",
        });
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

    test("rememberTurn writes structured memory actions as ledger atoms", async () => {
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

    test("hippocampus context reads durable working memory without sidecar files", async () => {
        const config = await buildConfig();
        const memory = new MemoryModule(config, new CapturingSink());
        await memory.warmup();
        const ctx = withEmbedding(await embedFor(config, "durable hippocampus"));
        await memory.rememberTurn(msg("durable hippocampus"), rep("stored"), ctx, [
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
        // Simulate removing an old sidecar directory: hippocampus context must come from durable working memory.
        await rm(join(config.paths.home, "journal"), { recursive: true, force: true });

        const prompt = await memory.buildPrompt(msg("durable hippocampus follow-up"), {
            ...ctx,
            requestId: crypto.randomUUID(),
            embedding: await embedFor(config, "durable hippocampus"),
        });

        expect(prompt).toContain("Recent Notes");
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

        expect(prompt).toContain("Recent Notes");
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
        expect(prompt).toContain("Recent Notes");
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

    public async generate(messages: ModelMessage[]): Promise<string> {
        const system = messages.find((message) => message.role === "system")?.content ?? "";
        if (system.includes("Decide whether the current request should proceed directly")) {
            return JSON.stringify({
                decision: "direct",
                reason: "test direct path",
                confidence: 1,
                planTitle: "",
                planSummary: "",
                askPrompt: "",
            });
        }
        if (system.includes("decide whether the assistant must use available local tools")) {
            return JSON.stringify({
                decision: "answer",
                calls: [],
                reason: "test answer path",
            });
        }
        if (system.includes("focused helper tasks before the main assistant answers")) {
            return JSON.stringify({
                decision: "continue",
                tasks: [],
                concurrency: 0,
                maxToolTurns: 0,
                reason: "test no subtask delegation",
            });
        }
        return this.response;
    }
}

class RouteJsonModel implements ModelClient {
    public calls = 0;

    public async generate(_messages: ModelMessage[]): Promise<string> {
        this.calls += 1;
        return JSON.stringify({
            mode: BlackboardMode.Blackboard,
            score: 0.82,
            reason: "strict geometric definitions conflict under the user's constraints",
            signals: ["formal-definition-conflict", "exact-formula-required"],
            needsReflectionCandidate: true,
            blackboardContract: {
                mode: "non-convergent",
                policyReason: "strict definitions cannot be simultaneously satisfied",
                evidence: ["strict square", "strict circle", "no approximation"],
                contradictions: [
                    {
                        left: "strict square boundary",
                        right: "strict circle boundary",
                        reason: "a single planar figure cannot satisfy both definitions exactly",
                    },
                ],
            },
            workers: [
                {
                    role: "geometry-proposer",
                    name: "Geometry proposer",
                    stage: "analysis",
                    handoff: "analysis",
                    capabilities: ["state formal definitions"],
                    dependsOn: [],
                },
                {
                    role: "contradiction-checker",
                    name: "Contradiction checker",
                    stage: "review",
                    handoff: "review",
                    capabilities: ["verify incompatibility"],
                    dependsOn: ["geometry-proposer"],
                },
            ],
        });
    }
}

class CountingRouteThenReplyModel implements ModelClient {
    public routeCalls = 0;

    public constructor(private readonly reply: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        const first = messages[0]?.content ?? "";
        if (first.includes("Treat worker selection as a small game")) {
            this.routeCalls += 1;
            return JSON.stringify({
                mode: BlackboardMode.Blackboard,
                score: 1,
                reason: "test non-convergent route",
                signals: ["test-conflict"],
                needsReflectionCandidate: false,
                blackboardContract: {
                    mode: "non-convergent",
                    policyReason: "test-hard-cap",
                    evidence: ["structured-test"],
                    contradictions: [{ left: "left", right: "right", reason: "incompatible" }],
                },
                workers: [
                    { role: "perf-analysis-worker", name: "Analysis", handoff: "analysis" },
                    { role: "perf-review-worker", name: "Review", handoff: "review" },
                ],
            });
        }
        if (first.includes("Decide whether the current request should proceed directly")) {
            return JSON.stringify({
                decision: "direct",
                reason: "test direct path",
                confidence: 1,
                planTitle: "",
                planSummary: "",
                askPrompt: "",
            });
        }
        if (first.includes("decide whether the assistant must use available local tools")) {
            return JSON.stringify({
                decision: "answer",
                calls: [],
                reason: "test answer path",
            });
        }
        if (first.includes("focused helper tasks before the main assistant answers")) {
            return JSON.stringify({
                decision: "continue",
                tasks: [],
                concurrency: 0,
                maxToolTurns: 0,
                reason: "test no subtask delegation",
            });
        }
        return this.reply;
    }
}

class FinalBlackboardRouteThenReplyModel implements ModelClient {
    public constructor(private readonly reply: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        const first = messages[0]?.content ?? "";
        if (first.includes("Treat worker selection as a small game")) {
            return JSON.stringify({
                mode: BlackboardMode.Blackboard,
                score: 1,
                reason: "test convergent blackboard route",
                signals: ["test-convergent"],
                needsReflectionCandidate: false,
                blackboardContract: {
                    mode: "normal",
                    policyReason: "test-convergent",
                    evidence: ["structured-test"],
                    contradictions: [],
                },
                workers: [{ role: "perf-final-worker", name: "Final", handoff: "final" }],
            });
        }
        if (first.includes("Decide whether the current request should proceed directly")) {
            return JSON.stringify({
                decision: "direct",
                reason: "test direct path",
                confidence: 1,
                planTitle: "",
                planSummary: "",
                askPrompt: "",
            });
        }
        if (first.includes("decide whether the assistant must use available local tools")) {
            return JSON.stringify({
                decision: "answer",
                calls: [],
                reason: "test answer path",
            });
        }
        if (first.includes("focused helper tasks before the main assistant answers")) {
            return JSON.stringify({
                decision: "continue",
                tasks: [],
                concurrency: 0,
                maxToolTurns: 0,
                reason: "test no subtask delegation",
            });
        }
        return this.reply;
    }
}

class DirectWatchRouteThenReplyModel implements ModelClient {
    public constructor(private readonly reply: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        const first = messages[0]?.content ?? "";
        if (first.includes("Treat worker selection as a small game")) {
            return JSON.stringify({
                mode: BlackboardMode.DirectWithWatch,
                score: 0.55,
                reason: "test watch route",
                signals: ["test-watch"],
                needsReflectionCandidate: false,
                workers: [],
            });
        }
        if (first.includes("Decide whether the current request should proceed directly")) {
            return JSON.stringify({
                decision: "direct",
                reason: "test direct path",
                confidence: 1,
                planTitle: "",
                planSummary: "",
                askPrompt: "",
            });
        }
        if (first.includes("decide whether the assistant must use available local tools")) {
            return JSON.stringify({
                decision: "answer",
                calls: [],
                reason: "test answer path",
            });
        }
        if (first.includes("focused helper tasks before the main assistant answers")) {
            return JSON.stringify({
                decision: "continue",
                tasks: [],
                concurrency: 0,
                maxToolTurns: 0,
                reason: "test no subtask delegation",
            });
        }
        return this.reply;
    }
}

class ScopeRecallRouteThenReplyModel implements ModelClient {
    public constructor(private readonly scopeId: string, private readonly reply: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        const first = messages[0]?.content ?? "";
        if (first.includes("decide whether the current user request refers to one existing named work context")) {
            return JSON.stringify({
                decision: "load",
                scopeId: this.scopeId,
                candidateScopeIds: [this.scopeId],
                confidence: 0.93,
                reason: "structured scope recall fixture",
            });
        }
        if (first.includes("Treat worker selection as a small game")) {
            return JSON.stringify({
                mode: BlackboardMode.Direct,
                score: 0.1,
                reason: "test direct route",
                signals: [],
                needsReflectionCandidate: false,
                workers: [],
            });
        }
        if (first.includes("Decide whether the current request should proceed directly")) {
            return JSON.stringify({
                decision: "direct",
                reason: "test direct path",
                confidence: 1,
                planTitle: "",
                planSummary: "",
                askPrompt: "",
            });
        }
        if (first.includes("decide whether the assistant must use available local tools")) {
            return JSON.stringify({
                decision: "answer",
                calls: [],
                reason: "test answer path",
            });
        }
        if (first.includes("focused helper tasks before the main assistant answers")) {
            return JSON.stringify({
                decision: "continue",
                tasks: [],
                concurrency: 0,
                maxToolTurns: 0,
                reason: "test no subtask delegation",
            });
        }
        return this.reply;
    }
}

@Worker("perf-analysis-worker")
class RuntimePerfAnalysisWorker {
    public run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return runtimePerfBlockedWorkerResult("perf-analysis-worker", input);
    }
}

@Worker("perf-final-worker")
class RuntimePerfFinalWorker {
    public run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "perf-final-worker public blackboard transcript",
            agreement: true,
            outcome: BlackboardWorkerOutcome.Final,
            answers: ["answer"],
            newFacts: ["fact"],
            openIssues: [],
            blockers: [],
            questions: [],
            risk: "low",
        };
    }
}

@Worker("perf-review-worker")
class RuntimePerfReviewWorker {
    public run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return runtimePerfBlockedWorkerResult("perf-review-worker", input);
    }
}

function runtimePerfBlockedWorkerResult(role: string, input: BlackboardWorkerTask): BlackboardWorkerResult {
    return {
        inputSummary: input.prompt ?? input.goal,
        outputSummary: `${role} remains blocked at round ${input.round}`,
        agreement: false,
        outcome: BlackboardWorkerOutcome.Continue,
        answers: [],
        newFacts: [`${role}.round=${input.round}`],
        openIssues: [`${role}.needs-user-decision`],
        blockers: [`${role}.blocked`],
        questions: [`${role}.choose-next-step`],
        risk: "medium",
    };
}

class FailingFastRouteSnapshotStore implements FastRouteSnapshotStore {
    public async get(_key: string): Promise<FastRouteSnapshot | undefined> {
        return undefined;
    }

    public async set(_key: string, _snapshot: FastRouteSnapshot): Promise<void> {
        throw new Error("fast-route-cache-down");
    }
}

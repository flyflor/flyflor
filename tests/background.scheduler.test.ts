import { afterEach, describe, expect, test } from "bun:test";
import { BackgroundScheduler } from "../src/cognitive/hippocampus/memory/lifecycle/index.ts";
import { ConsolidationDecisionKind, type ConsolidationRunResult } from "../src/cognitive/hippocampus/memory/consolidation/index.ts";
import { RuntimeEventType } from "../src/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import type { WorkingMemoryHealthSnapshot } from "../src/cognitive/hippocampus/memory/working/index.ts";

class FakeEvents {
    public readonly published: RuntimeEvent[] = [];
    public publish(e: RuntimeEvent): void {
        this.published.push(e);
    }
    public subscribe(): () => void {
        return () => undefined;
    }
}

class FakeConsolidation {
    public readonly drained: string[] = [];
    public fail = false;
    public result: ConsolidationRunResult = {
        scanned: 1,
        reinforced: 1,
        consolidated: 0,
        discarded: 0,
        skipped: 0,
    };
    public async drain(userId: string): Promise<ConsolidationRunResult> {
        this.drained.push(userId);
        if (this.fail) throw new Error("boom-consolidation");
        return this.result;
    }
}

class FakeGraph {
    public readonly swept: Array<{ userId: string; batchSize?: number }> = [];
    public failNext = false;
    public decayBudget = { mn: 3, sk: 1 };
    public async applyDecaySweep(input: {
        userId: string;
        batchSize?: number;
        decayMemoryNode: (row: { importance: number; updatedAt: number }) => number;
        decayGem: (row: { importance: number; updatedAt: number; lastVerifiedAt?: number }) => number;
    }): Promise<{ memoryNodes: number; gems: number }> {
        this.swept.push({ userId: input.userId, batchSize: input.batchSize });
        if (this.failNext) {
            this.failNext = false;
            throw new Error("boom-decay");
        }
        // call the decay funcs to make sure inputs are wired
        input.decayMemoryNode({ importance: 0.5, updatedAt: 0 });
        input.decayGem({ importance: 0.5, updatedAt: 0, lastVerifiedAt: 0 });
        return { memoryNodes: this.decayBudget.mn, gems: this.decayBudget.sk };
    }
}

class FakeDream {
    public readonly drained: Array<{ userId: string; limit?: number }> = [];
    public async drain(userId: string, limit?: number) {
        this.drained.push({ userId, limit });
        return { rewritten: 1, discarded: 0, skipped: 0 };
    }
    public async enqueue() {}
}

class FakeHotCompression {
    public readonly drained: string[] = [];
    public async drain(userId: string) {
        this.drained.push(userId);
        return { scanned: 2, compressed: 1, deleted: 2, missing: 0, skipped: 0 };
    }
}

function build(extra?: { dream?: FakeDream; workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined }): {
    scheduler: BackgroundScheduler;
    consolidation: FakeConsolidation;
    graph: FakeGraph;
    events: FakeEvents;
} {
    const consolidation = new FakeConsolidation();
    const graph = new FakeGraph();
    const events = new FakeEvents();
    const scheduler = new BackgroundScheduler(consolidation as never, graph as never, events, {
        consolidationIntervalMs: 1_000,
        decayIntervalMs: 1_000,
        decayBatchSize: 50,
        now: () => 1_700_000_000_000,
        dream: extra?.dream as never,
        workingMemoryHealthSnapshot: extra?.workingMemoryHealthSnapshot,
    });
    return { scheduler, consolidation, graph, events };
}

const SCHEDULERS: BackgroundScheduler[] = [];
afterEach(() => {
    while (SCHEDULERS.length) SCHEDULERS.pop()?.stop();
});

describe("BackgroundScheduler", () => {
    test("trackUser dedupes and counts", () => {
        const { scheduler } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        scheduler.trackUser("u1");
        scheduler.trackUser("u2");
        scheduler.trackUser("");
        // @ts-expect-error garbage
        scheduler.trackUser(null);
        expect(scheduler.activeUsers()).toBe(2);
    });

    test("runConsolidationOnce drains every active user", async () => {
        const { scheduler, consolidation } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("a");
        scheduler.trackUser("b");
        consolidation.result = {
            scanned: 2,
            reinforced: 1,
            consolidated: 1,
            discarded: 0,
            skipped: 0,
        };
        const totals = await scheduler.runConsolidationOnce();
        expect(consolidation.drained.sort()).toEqual(["a", "b"]);
        expect(totals.users).toBe(2);
        expect(totals.consolidated).toBe(2);
        expect(totals.reinforced).toBe(2);
    });

    test("runConsolidationOnce skips while working memory breaker is cooling down", async () => {
        const { scheduler, consolidation } = build({
            workingMemoryHealthSnapshot: () => ({
                circuitState: "open",
                nextRetryAt: 1_700_000_001_000,
            }),
        });
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("a");
        scheduler.trackUser("b");

        const totals = await scheduler.runConsolidationOnce();

        expect(totals).toEqual({ users: 0, consolidated: 0, reinforced: 0, discarded: 0 });
        expect(consolidation.drained).toEqual([]);
    });

    test("runConsolidationOnce swallows per-user failure and continues", async () => {
        const { scheduler, consolidation, events } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("ok");
        scheduler.trackUser("ko");
        // fail every drain — both users emit a failure event, totals.users=0
        consolidation.fail = true;
        const totals = await scheduler.runConsolidationOnce();
        expect(totals.users).toBe(0);
        const failures = events.published.filter((e) => e.type === RuntimeEventType.MemoryConsolidationFailed);
        expect(failures.length).toBe(2);
    });

    test("runConsolidationOnce is reentrant-safe", async () => {
        const { scheduler, consolidation } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("a");
        // Force a hang via promise; the second call must early-exit with zeros
        let release!: () => void;
        const block = new Promise<ConsolidationRunResult>((resolve) => {
            release = () => resolve({ scanned: 0, reinforced: 0, consolidated: 0, discarded: 0, skipped: 0 });
        });
        consolidation.drain = () => block;
        const first = scheduler.runConsolidationOnce();
        const second = await scheduler.runConsolidationOnce();
        expect(second.users).toBe(0);
        release();
        await first;
    });

    test("runDecayOnce sweeps each user with batch size and emits event", async () => {
        const { scheduler, graph, events } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        scheduler.trackUser("u2");
        const totals = await scheduler.runDecayOnce();
        expect(totals.users).toBe(2);
        expect(totals.memoryNodes).toBe(6);
        expect(totals.gems).toBe(2);
        expect(graph.swept.map((s) => s.userId).sort()).toEqual(["u1", "u2"]);
        for (const s of graph.swept) expect(s.batchSize).toBe(50);
        const swept = events.published.filter((e) => e.type === RuntimeEventType.MemoryDecaySwept);
        expect(swept.length).toBe(1);
    });

    test("runDecayOnce continues past a failing user", async () => {
        const { scheduler, graph, events } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("bad");
        scheduler.trackUser("good");
        graph.failNext = true;
        const totals = await scheduler.runDecayOnce();
        expect(totals.users).toBe(1);
        const failures = events.published.filter((e) => e.type === RuntimeEventType.MemoryConsolidationFailed);
        expect(failures.length).toBe(1);
    });

    test("start / stop are idempotent and timers fire periodically", async () => {
        const { scheduler, consolidation } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u");
        scheduler.start();
        scheduler.start(); // restart should be safe
        await new Promise((r) => setTimeout(r, 1_200));
        scheduler.stop();
        scheduler.stop();
        expect(consolidation.drained.length).toBeGreaterThan(0);
    });

    test("zero users → totals zero, no exceptions", async () => {
        const { scheduler } = build();
        SCHEDULERS.push(scheduler);
        const c = await scheduler.runConsolidationOnce();
        const d = await scheduler.runDecayOnce();
        expect(c.users).toBe(0);
        expect(d.users).toBe(0);
    });

    test("decay function actually applies decay layer profile", async () => {
        const { scheduler, graph } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u");
        let captured = 0;
        graph.applyDecaySweep = async (input) => {
            captured = input.decayMemoryNode({ importance: 1, updatedAt: 0 });
            return { memoryNodes: 0, gems: 0 };
        };
        await scheduler.runDecayOnce();
        // After many half-lives the decay profile clamps to the floor; just verify it actually decayed below 1.
        expect(captured).toBeLessThan(1);
        expect(captured).toBeGreaterThanOrEqual(0);
    });

    test("decision kinds enum still triple", () => {
        // Sanity check we did not accidentally extend the enum
        expect(Object.values(ConsolidationDecisionKind).sort()).toEqual(["consolidate", "discard", "reinforce"]);
    });

    test("runProjectClusterOnce invokes injected sweeper for tracked users only", async () => {
        const consolidation = new FakeConsolidation();
        const graph = new FakeGraph();
        const events = new FakeEvents();
        const called: string[] = [];
        const scheduler = new BackgroundScheduler(consolidation as never, graph as never, events, {
            consolidationIntervalMs: 1_000,
            decayIntervalMs: 1_000,
            projectClusterIntervalMs: 1_000,
            projectSweeper: async (userId: string) => {
                called.push(userId);
                return userId === "u2";
            },
        });
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        scheduler.trackUser("u2");
        const r = await scheduler.runProjectClusterOnce();
        expect(called.sort()).toEqual(["u1", "u2"]);
        expect(r.users).toBe(2);
        expect(r.offers).toBe(1);
        const snap = scheduler.snapshot();
        expect(snap.projectClusterEnabled).toBe(true);
        expect(snap.projectClusterBusy).toBe(false);
    });

    test("runProjectClusterOnce without sweeper is no-op", async () => {
        const { scheduler } = build();
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        const r = await scheduler.runProjectClusterOnce();
        expect(r).toEqual({ users: 0, offers: 0 });
        expect(scheduler.snapshot().projectClusterEnabled).toBe(false);
    });

    test("runBrainArchiveOnce invokes global sweeper without requiring users", async () => {
        const consolidation = new FakeConsolidation();
        const graph = new FakeGraph();
        const events = new FakeEvents();
        let called = 0;
        const scheduler = new BackgroundScheduler(consolidation as never, graph as never, events, {
            consolidationIntervalMs: 1_000,
            decayIntervalMs: 1_000,
            brainArchiveIntervalMs: 1_000,
            brainArchiveSweeper: async () => {
                called += 1;
                return { eventsCopied: 3, months: 1, vacuumed: true };
            },
        });
        SCHEDULERS.push(scheduler);
        const r = await scheduler.runBrainArchiveOnce();
        expect(called).toBe(1);
        expect(r).toEqual({ eventsCopied: 3, months: 1, skippedBusy: false, vacuumed: true });
        expect(scheduler.snapshot().brainArchiveEnabled).toBe(true);
    });

    test("runHotMemoryCompressionOnce invokes injected worker for tracked users", async () => {
        const consolidation = new FakeConsolidation();
        const graph = new FakeGraph();
        const events = new FakeEvents();
        const hot = new FakeHotCompression();
        const scheduler = new BackgroundScheduler(consolidation as never, graph as never, events, {
            consolidationIntervalMs: 1_000,
            decayIntervalMs: 1_000,
            hotMemoryCompressionIntervalMs: 1_000,
            hotMemoryCompression: hot as never,
        });
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        scheduler.trackUser("u2");
        const r = await scheduler.runHotMemoryCompressionOnce();
        expect(hot.drained.sort()).toEqual(["u1", "u2"]);
        expect(r).toEqual({ users: 2, compressed: 2, deleted: 4, missing: 0, skipped: 0 });
        expect(scheduler.snapshot().hotMemoryCompressionEnabled).toBe(true);
        expect(scheduler.snapshot().hotMemoryCompressionBusy).toBe(false);
    });

    test("runHotMemoryCompressionOnce waits for brain.db maintenance to clear", async () => {
        const consolidation = new FakeConsolidation();
        const graph = new FakeGraph();
        const events = new FakeEvents();
        const hot = new FakeHotCompression();
        let releaseSummary!: () => void;
        const summaryHold = new Promise<{ written: number }>((resolve) => {
            releaseSummary = () => resolve({ written: 1 });
        });
        const scheduler = new BackgroundScheduler(consolidation as never, graph as never, events, {
            consolidationIntervalMs: 1_000,
            decayIntervalMs: 1_000,
            summaryIntervalMs: 1_000,
            hotMemoryCompressionIntervalMs: 1_000,
            summarySweeper: async () => summaryHold,
            hotMemoryCompression: hot as never,
        });
        SCHEDULERS.push(scheduler);
        scheduler.trackUser("u1");
        const summaryRun = scheduler.runSummarySweepOnce();
        const hotRun = await scheduler.runHotMemoryCompressionOnce();
        expect(hotRun).toEqual({ users: 0, compressed: 0, deleted: 0, missing: 0, skipped: 0 });
        releaseSummary();
        await summaryRun;
        expect(hot.drained).toEqual([]);
        expect(scheduler.snapshot().hotMemoryCompressionBusy).toBe(false);
    });
});

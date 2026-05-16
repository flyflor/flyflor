import { afterEach, describe, expect, test } from "bun:test";
import { BackgroundScheduler } from "../src/neural/memory/background.scheduler.ts";
import { NullEventSink } from "../src/protocol/events/index.ts";
import type { DreamWorker, DreamRunResult } from "../src/neural/memory/dream.worker.ts";

const ZERO: DreamRunResult = {
    scanned: 0,
    driftRepaired: 0,
    recallReinforced: 0,
    contradictionsFlagged: 0,
    reconsolidated: 0,
    skipped: 0,
};

class FakeDream implements DreamWorker {
    public calls: Array<{ userId: string; limit?: number }> = [];
    public shouldThrow = false;
    public result: DreamRunResult = { ...ZERO, driftRepaired: 1 };
    public async runOnce(userId: string, limit?: number): Promise<DreamRunResult> {
        this.calls.push({ userId, limit });
        if (this.shouldThrow) throw new Error("dream-boom");
        return this.result;
    }
}

class StubGraph {
    public async applyDecaySweep(): Promise<{ memoryNodes: number; gems: number }> {
        return { memoryNodes: 0, gems: 0 };
    }
}

class StubConsolidation {
    public async drain(): Promise<{
        scanned: number;
        reinforced: number;
        consolidated: number;
        discarded: number;
        skipped: number;
    }> {
        return { scanned: 0, reinforced: 0, consolidated: 0, discarded: 0, skipped: 0 };
    }
}

function build(
    dream: FakeDream | undefined,
    idleDreamTriggerMs: number,
): BackgroundScheduler {
    return new BackgroundScheduler(
        new StubConsolidation() as never,
        new StubGraph() as never,
        new NullEventSink(),
        {
            consolidationIntervalMs: 60_000,
            decayIntervalMs: 60_000,
            dreamIntervalMs: 0,
            idleDreamTriggerMs,
            dream: dream as never,
        },
    );
}

async function tick(ms = 0): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

const ALL: BackgroundScheduler[] = [];
afterEach(() => {
    while (ALL.length) ALL.pop()?.stop();
});

describe("BackgroundScheduler idle-trigger", () => {
    test("noteUserTurn fires dream after idle threshold elapses", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 20);
        ALL.push(sched);
        sched.noteUserTurn("alice");
        expect(sched.activeUsers()).toBe(1);
        await tick(50);
        expect(dream.calls).toHaveLength(1);
        expect(dream.calls[0]?.userId).toBe("alice");
    });

    test("rapid successive turns reset the idle timer (no premature fire)", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 30);
        ALL.push(sched);
        sched.noteUserTurn("bob");
        await tick(15);
        sched.noteUserTurn("bob");
        await tick(15);
        sched.noteUserTurn("bob");
        await tick(15);
        expect(dream.calls).toHaveLength(0);
        await tick(40);
        expect(dream.calls).toHaveLength(1);
    });

    test("idle trigger 0 disables (no dream call even after long idle)", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 0);
        ALL.push(sched);
        sched.noteUserTurn("c");
        await tick(50);
        expect(dream.calls).toHaveLength(0);
    });

    test("dream not provided → noteUserTurn is silent (no throw, no calls)", async () => {
        const sched = build(undefined, 10);
        ALL.push(sched);
        expect(() => sched.noteUserTurn("nobody")).not.toThrow();
        await tick(30);
        // no dream → nothing to verify but no crash
        expect(sched.activeUsers()).toBe(1);
    });

    test("dream.runOnce throwing does not propagate or break future triggers", async () => {
        const dream = new FakeDream();
        dream.shouldThrow = true;
        const sched = build(dream, 15);
        ALL.push(sched);
        sched.noteUserTurn("x");
        await tick(40);
        expect(dream.calls).toHaveLength(1);
        // second cycle still works after error
        dream.shouldThrow = false;
        sched.noteUserTurn("x");
        await tick(40);
        expect(dream.calls).toHaveLength(2);
    });

    test("stop() clears pending idle timers (no fire after stop)", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 25);
        sched.noteUserTurn("y");
        sched.stop();
        await tick(50);
        expect(dream.calls).toHaveLength(0);
    });

    test("[chaos] 200 rapid noteUserTurn calls on same user keep exactly one pending timer", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 30);
        ALL.push(sched);
        for (let i = 0; i < 200; i++) sched.noteUserTurn("flood");
        await tick(60);
        // 即使 200 次重置，最终只触发一次 dream（最后一次的 timer 生效）。
        expect(dream.calls).toHaveLength(1);
    });

    test("[chaos] mixed users fire independent idle timers", async () => {
        const dream = new FakeDream();
        const sched = build(dream, 20);
        ALL.push(sched);
        sched.noteUserTurn("u1");
        sched.noteUserTurn("u2");
        sched.noteUserTurn("u3");
        await tick(60);
        const users = dream.calls.map((c) => c.userId).sort();
        expect(users).toEqual(["u1", "u2", "u3"]);
    });

    test("[chaos] garbage userId values do nothing", () => {
        const dream = new FakeDream();
        const sched = build(dream, 10);
        ALL.push(sched);
        sched.noteUserTurn("");
        // @ts-expect-error null
        sched.noteUserTurn(null);
        // @ts-expect-error number
        sched.noteUserTurn(123);
        expect(sched.activeUsers()).toBe(0);
    });

    test("[chaos] noteUserTurn during in-flight dream skips duplicate fire", async () => {
        const dream = new FakeDream();
        // 让 runOnce 慢一点，模拟"还没跑完又来一次"
        let slow = true;
        dream.runOnce = async (userId: string) => {
            dream.calls.push({ userId });
            if (slow) {
                slow = false;
                await new Promise((resolve) => setTimeout(resolve, 40));
            }
            return ZERO;
        };
        const sched = build(dream, 15);
        ALL.push(sched);
        sched.noteUserTurn("z");
        await tick(20);
        // 第一次正在 in-flight
        expect(dream.calls).toHaveLength(1);
        sched.noteUserTurn("z");
        await tick(20);
        // 第二次 timer 命中时第一次还没跑完 → dreamBusy 短路；calls 仍 1
        expect(dream.calls).toHaveLength(1);
        // 等第一次跑完
        await tick(40);
        sched.noteUserTurn("z");
        await tick(40);
        expect(dream.calls.length).toBeGreaterThanOrEqual(2);
    });
});

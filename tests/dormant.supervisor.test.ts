import { describe, expect, test } from "bun:test";
import { DormantSupervisor } from "../src/neural/memory/dormant.supervisor.ts";
import { RuntimeMode } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

class CapturingSink implements EventSink {
    readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publish(event: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(event);
    }
}

describe("DormantSupervisor", () => {
    test("touch registers user in Chat mode", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new DormantSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
    });

    test("sweep moves idle Chat user → Dormant after threshold", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new DormantSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 4 * 60_000;
        expect(sup.sweepOnce().entered).toBe(0);
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
        now += 2 * 60_000;
        const r = sup.sweepOnce();
        expect(r.entered).toBe(1);
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Dormant);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.RuntimeModeEntered);
    });

    test("touch wakes Dormant user → Chat", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new DormantSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 10 * 60_000;
        sup.sweepOnce();
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Dormant);
        sup.touch("u1");
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.RuntimeModeAwakened);
    });

    test("snapshot reports per-user idle time", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new DormantSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        sup.touch("u2");
        now += 3 * 60_000;
        const snap = sup.snapshot();
        expect(snap).toHaveLength(2);
        expect(snap.every((s) => s.idleMs === 3 * 60_000)).toBe(true);
        expect(snap.every((s) => s.mode === RuntimeMode.Chat)).toBe(true);
    });

    test("unknown user defaults to Chat", () => {
        const sink = new CapturingSink();
        const sup = new DormantSupervisor(sink, { idleMinutes: 5 });
        expect(sup.modeOf("nobody")).toBe(RuntimeMode.Chat);
    });
});

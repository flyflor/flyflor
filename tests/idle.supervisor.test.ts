import { describe, expect, test } from "bun:test";
import { IdleSupervisor } from "../src/cognitive/hippocampus/idle/index.ts";
import { RuntimeMode } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(event: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(event);
    }
}

describe("IdleSupervisor", () => {
    test("touch registers owner in Chat mode", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new IdleSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
    });

    test("sweep moves idle Chat owner → Idle after threshold", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new IdleSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 4 * 60_000;
        expect(sup.sweepOnce().entered).toBe(0);
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
        now += 2 * 60_000;
        const r = sup.sweepOnce();
        expect(r.entered).toBe(1);
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Idle);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.RuntimeModeEntered);
    });

    test("touch wakes Idle owner → Chat", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new IdleSupervisor(sink, { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 10 * 60_000;
        sup.sweepOnce();
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Idle);
        sup.touch("u1");
        expect(sup.modeOf("u1")).toBe(RuntimeMode.Chat);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.RuntimeModeAwakened);
    });

    test("snapshot reports per-owner idle time", () => {
        let now = 1_000_000_000;
        const sink = new CapturingSink();
        const sup = new IdleSupervisor(sink, { idleMinutes: 5, now: () => now });
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
        const sup = new IdleSupervisor(sink, { idleMinutes: 5 });
        expect(sup.modeOf("nobody")).toBe(RuntimeMode.Chat);
    });

    test("LF-R8 peekResumeHint returns null when not Idle", () => {
        let now = 1_000_000_000;
        const sup = new IdleSupervisor(new CapturingSink(), { idleMinutes: 5, now: () => now });
        expect(sup.peekResumeHint("u1")).toBeNull();
        sup.touch("u1");
        expect(sup.peekResumeHint("u1")).toBeNull();
    });

    test("LF-R8 peekResumeHint returns idleMs after sweep into Idle", () => {
        let now = 1_000_000_000;
        const sup = new IdleSupervisor(new CapturingSink(), { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 12 * 60_000;
        sup.sweepOnce();
        const hint = sup.peekResumeHint("u1");
        expect(hint).not.toBeNull();
        expect(hint!.idleMs).toBe(12 * 60_000);
    });

    test("LF-R8 peekResumeHint cleared after touch (awaken)", () => {
        let now = 1_000_000_000;
        const sup = new IdleSupervisor(new CapturingSink(), { idleMinutes: 5, now: () => now });
        sup.touch("u1");
        now += 12 * 60_000;
        sup.sweepOnce();
        expect(sup.peekResumeHint("u1")).not.toBeNull();
        sup.touch("u1");
        expect(sup.peekResumeHint("u1")).toBeNull();
    });
});

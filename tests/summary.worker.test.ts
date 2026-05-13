import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainStore } from "../src/neural/memory/brain.store.ts";
import { SummaryWorker, aggregate } from "../src/neural/memory/summary.worker.ts";
import {
    MemoryEventType,
    ModelRole,
    SummaryRange,
    type MemoryEventRecord,
} from "../src/protocol/contracts/index.ts";

async function freshStore() {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-summary-worker-"));
    const store = new BrainStore({ dbPath: join(dir, "brain.db") });
    await store.open();
    return { store };
}

function mkEvent(over: Partial<MemoryEventRecord> & { id: string; ts: number }): MemoryEventRecord {
    return {
        id: over.id,
        ts: over.ts,
        userId: over.userId ?? "u1",
        channelId: over.channelId ?? "stdio",
        codenameId: over.codenameId,
        type: over.type ?? MemoryEventType.Event,
        role: over.role ?? ModelRole.User,
        content: over.content ?? {},
        importance: over.importance ?? 0.5,
        embeddingId: over.embeddingId,
        timeBucket: over.timeBucket ?? "2026-05-13",
    } satisfies MemoryEventRecord;
}

describe("SummaryWorker.aggregate", () => {
    test("aggregates type/role counts, codenames, ask/ghost/identity buckets", () => {
        const rows: MemoryEventRecord[] = [
            mkEvent({ id: "a", ts: 100, type: MemoryEventType.Event, role: ModelRole.User, codenameId: "c1" }),
            mkEvent({ id: "b", ts: 200, type: MemoryEventType.Ask, role: ModelRole.Assistant }),
            mkEvent({ id: "c", ts: 300, type: MemoryEventType.AskAnswerPair, role: ModelRole.Assistant }),
            mkEvent({
                id: "d",
                ts: 400,
                type: MemoryEventType.GhostContext,
                role: ModelRole.Assistant,
                content: { reason: "fork" },
            }),
            mkEvent({
                id: "e",
                ts: 500,
                type: MemoryEventType.GhostContext,
                role: ModelRole.Assistant,
                content: { reason: "fork" },
            }),
            mkEvent({ id: "f", ts: 600, type: MemoryEventType.IdentityAppend, codenameId: "c2" }),
        ];
        const stats = aggregate(rows);
        expect(stats.totalEvents).toBe(6);
        expect(stats.byType[MemoryEventType.Ask]).toBe(1);
        expect(stats.byType[MemoryEventType.GhostContext]).toBe(2);
        expect(stats.asksAsked).toBe(1);
        expect(stats.asksAnswered).toBe(1);
        expect(stats.ghostsRecorded).toBe(2);
        expect(stats.ghostReasons.fork).toBe(2);
        expect(stats.identityAppends).toBe(1);
        expect(stats.codenamesTouched).toEqual(["c1", "c2"]);
        expect(stats.firstTs).toBe(100);
        expect(stats.lastTs).toBe(600);
    });

    test("empty input yields zeroed stats", () => {
        const s = aggregate([]);
        expect(s.totalEvents).toBe(0);
        expect(s.firstTs).toBeNull();
        expect(s.lastTs).toBeNull();
        expect(s.codenamesTouched).toEqual([]);
    });
});

describe("SummaryWorker.runOnceForUser", () => {
    test("writes day + rolling-week summary when events exist", async () => {
        const { store } = await freshStore();
        try {
            const now = Date.UTC(2026, 4, 13, 12, 0, 0);
            store.appendEvent({
                id: "e1",
                ts: now - 60_000,
                userId: "u1",
                channelId: "stdio",
                codenameId: "c1",
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: { text: "hi" },
                importance: 0.5,
            });
            const w = new SummaryWorker(store, { trigger: "rolling", rollingWindowDays: 7, minIntervalHours: 24, now: () => now });
            const r = w.runOnceForUser("u1");
            expect(r.written).toBe(2);
            expect(r.skippedEmpty).toBe(0);
            const day = store.getSummary("summary-u1-day-2026-05-13");
            expect(day).not.toBeNull();
            const parsed = JSON.parse(day!.content);
            expect(parsed.stats.totalEvents).toBe(1);
            const week = store.getSummary("summary-u1-week-rolling-2026-05-13-7d");
            expect(week).not.toBeNull();
        } finally {
            store.close();
        }
    });

    test("skips by minIntervalHours on second run within window", async () => {
        const { store } = await freshStore();
        try {
            const now = Date.UTC(2026, 4, 13, 12, 0, 0);
            store.appendEvent({
                id: "e1",
                ts: now - 60_000,
                userId: "u1",
                channelId: "stdio",
                codenameId: undefined,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {},
                importance: 0.5,
            });
            const w = new SummaryWorker(store, { minIntervalHours: 24, now: () => now });
            const first = w.runOnceForUser("u1");
            expect(first.written).toBe(2);
            const second = w.runOnceForUser("u1", now + 60_000);
            expect(second.written).toBe(0);
            expect(second.skippedByInterval).toBe(2);
        } finally {
            store.close();
        }
    });

    test("skips when bucket has no events", async () => {
        const { store } = await freshStore();
        try {
            const now = Date.UTC(2026, 4, 13, 12, 0, 0);
            const w = new SummaryWorker(store, { now: () => now });
            const r = w.runOnceForUser("ghost-user");
            expect(r.written).toBe(0);
            expect(r.skippedEmpty).toBe(2);
        } finally {
            store.close();
        }
    });

    test("calendar trigger uses ISO week key", async () => {
        const { store } = await freshStore();
        try {
            const now = Date.UTC(2026, 4, 13, 12, 0, 0); // 2026-05-13 Wed -> W20
            store.appendEvent({
                id: "e1",
                ts: now - 60_000,
                userId: "u1",
                channelId: "stdio",
                codenameId: undefined,
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: {},
                importance: 0.5,
            });
            const w = new SummaryWorker(store, { trigger: "calendar", now: () => now });
            const r = w.runOnceForUser("u1");
            expect(r.written).toBe(2);
            const week = store.getSummary("summary-u1-week-2026-W20");
            expect(week).not.toBeNull();
        } finally {
            store.close();
        }
    });
});

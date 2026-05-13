import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainStore } from "../src/neural/memory/brain.store.ts";
import {
    MemoryEventStatus,
    MemoryEventType,
    MemoryLinkType,
    ModelRole,
    SummaryRange,
} from "../src/protocol/contracts/index.ts";

async function freshStore() {
    const dir = await mkdtemp(join(tmpdir(), "flyflor-brain-store-"));
    const store = new BrainStore({ dbPath: join(dir, "brain.db") });
    await store.open();
    return { store, dir };
}

describe("BrainStore", () => {
    test("appends events and reads them back with time_bucket index", async () => {
        const { store } = await freshStore();
        try {
            const ts = Date.UTC(2026, 4, 13, 8, 0, 0);
            const event = store.appendEvent({
                id: "e1",
                ts,
                userId: "u1",
                channelId: "stdio",
                codenameId: "c1",
                type: MemoryEventType.Event,
                role: ModelRole.User,
                content: { text: "hello" },
                importance: 0.6,
            });
            expect(event.timeBucket).toBe("2026-05-13");
            const fetched = store.getEvent("e1");
            expect(fetched?.content).toEqual({ text: "hello" });
            const listed = store.listEvents({ userId: "u1", limit: 10 });
            expect(listed).toHaveLength(1);
            expect(listed[0]?.codenameId).toBe("c1");
        } finally {
            store.close();
        }
    });

    test("memory_events is append-only: updates go through memory_state", async () => {
        const { store } = await freshStore();
        try {
            const ts = Date.UTC(2026, 4, 13, 8, 0, 0);
            store.appendEvent({
                id: "e1",
                ts,
                userId: "u1",
                type: MemoryEventType.GhostContext,
                content: { reason: "ask", askedQuestion: "?" },
            });
            const state = store.upsertState("e1", {
                activation: 0.8,
                decayScore: 0.7,
                accessCount: 3,
                status: MemoryEventStatus.Resumed,
                resumedAt: ts + 1000,
            });
            expect(state.status).toBe(MemoryEventStatus.Resumed);
            const reread = store.getState("e1");
            expect(reread?.activation).toBeCloseTo(0.8);
            expect(reread?.accessCount).toBe(3);

            const merged = store.upsertState("e1", { accessCount: 5 });
            expect(merged.accessCount).toBe(5);
            expect(merged.activation).toBeCloseTo(0.8);
        } finally {
            store.close();
        }
    });

    test("filters events by codename + status + type", async () => {
        const { store } = await freshStore();
        try {
            const base = Date.UTC(2026, 4, 13, 0, 0, 0);
            store.appendEvent({
                id: "live",
                ts: base + 1000,
                userId: "u1",
                codenameId: "c1",
                type: MemoryEventType.GhostContext,
                content: {},
            });
            store.appendEvent({
                id: "abandoned",
                ts: base + 2000,
                userId: "u1",
                codenameId: "c1",
                type: MemoryEventType.GhostContext,
                content: {},
            });
            store.upsertState("abandoned", { status: MemoryEventStatus.Abandoned });
            store.appendEvent({
                id: "other-codename",
                ts: base + 3000,
                userId: "u1",
                codenameId: "c2",
                type: MemoryEventType.GhostContext,
                content: {},
            });

            const live = store.listEvents({
                codenameId: "c1",
                type: MemoryEventType.GhostContext,
                statusIn: [MemoryEventStatus.Live],
            });
            expect(live.map((e) => e.id)).toEqual(["live"]);

            const all = store.listEvents({ codenameId: "c1", type: MemoryEventType.GhostContext });
            expect(all.map((e) => e.id).sort()).toEqual(["abandoned", "live"].sort());
        } finally {
            store.close();
        }
    });

    test("writes summary, links and codenames", async () => {
        const { store } = await freshStore();
        try {
            store.writeSummary({
                id: "s1",
                timeRange: SummaryRange.Day,
                bucketKey: "2026-05-13",
                content: "today summary",
                createdAt: Date.now(),
            });
            const summaries = store.listSummaries({ timeRange: SummaryRange.Day });
            expect(summaries).toHaveLength(1);

            // Links must reference existing events (FK ON)
            const ts = Date.UTC(2026, 4, 13, 0, 0, 0);
            store.appendEvent({ id: "from", ts, userId: "u1", type: MemoryEventType.Event, content: {} });
            store.appendEvent({ id: "to", ts: ts + 1, userId: "u1", type: MemoryEventType.Event, content: {} });
            store.writeLink({
                id: "l1",
                fromId: "from",
                toId: "to",
                strength: 0.9,
                type: MemoryLinkType.Contradicts,
                createdAt: ts + 2,
            });
            const links = store.listLinks({ fromId: "from" });
            expect(links).toHaveLength(1);
            expect(links[0]?.type).toBe(MemoryLinkType.Contradicts);

            const now = Date.now();
            store.upsertCodename({
                id: "code-1",
                name: "projA",
                userId: "u1",
                createdAt: now,
                lastUsedAt: now,
                useCount: 0,
                description: "工程 A 的代号",
                workingDir: "/tmp/projA",
            });
            store.touchCodename("code-1", now + 1000);
            const reread = store.getCodenameByName("u1", "projA");
            expect(reread?.useCount).toBe(1);
            expect(reread?.lastUsedAt).toBe(now + 1000);
        } finally {
            store.close();
        }
    });

    test("rejects use before open()", () => {
        const store = new BrainStore({ dbPath: "/tmp/not-open.db" });
        expect(() =>
            store.appendEvent({
                id: "x",
                ts: 0,
                userId: "u",
                type: MemoryEventType.Event,
                content: {},
            }),
        ).toThrow(/not opened/);
    });
});

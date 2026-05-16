import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrainStore } from "../src/components/memory/brain.store.ts";
import {
    MemoryEventStatus,
    MemoryEventType,
    MemoryLinkType,
    ModelRole,
    SceneRecordKind,
    SummaryRange,
    TaskPlanStatus,
    type ProjectRecord,
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

    test("schema keeps interactive recall paths on composite indexes", async () => {
        const { store, dir } = await freshStore();
        const brainPath = join(dir, "brain.db");
        try {
            store.close();
            const db = new Database(brainPath);
            try {
                const promptPlan = queryPlan(
                    db,
                    `EXPLAIN QUERY PLAN
                     SELECT e.* FROM memory_events e
                     LEFT JOIN memory_state s ON s.event_id = e.id
                     WHERE e.user_id = ? AND e.type = ? AND e.ts >= ?
                     ORDER BY e.ts DESC
                     LIMIT ?`,
                    ["u1", MemoryEventType.Event, 0, 100],
                );
                const pendingAskPlan = queryPlan(
                    db,
                    `EXPLAIN QUERY PLAN
                     SELECT e.* FROM memory_events e
                     LEFT JOIN memory_state s ON s.event_id = e.id
                     WHERE e.user_id = ? AND e.type = 'ask'
                       AND NOT EXISTS (
                         SELECT 1 FROM memory_events c
                         WHERE c.parent_id = e.id AND c.type = 'ask-answer-pair'
                       )
                     ORDER BY e.ts DESC
                     LIMIT 1`,
                    ["u1"],
                );

                // These are lifecycle-critical reads for prompt recall / pending ask checks.
                // The test pins index intent, not micro-benchmark timing, so it stays stable on CI.
                expect(promptPlan).toContain("idx_events_user_type_ts");
                expect(pendingAskPlan).toContain("idx_events_user_type_ts");
                expect(pendingAskPlan).toContain("idx_events_parent_type");
            } finally {
                db.close();
            }
        } finally {
            store.close();
        }
    });

    test("ask and ghost turn paths stay on indexed lookups", async () => {
        const { store, dir } = await freshStore();
        const brainPath = join(dir, "brain.db");
        try {
            store.close();
            const db = new Database(brainPath);
            try {
                const askPlan = queryPlan(
                    db,
                    `EXPLAIN QUERY PLAN
                     SELECT e.* FROM memory_events e
                     LEFT JOIN memory_state s ON s.event_id = e.id
                     WHERE e.user_id = ? AND e.type = 'ask'
                       AND COALESCE(s.status, 'live') IN ('live', 'resumed')
                       AND NOT EXISTS (
                         SELECT 1 FROM memory_events c
                         WHERE c.parent_id = e.id AND c.type = 'ask-answer-pair'
                       )
                     ORDER BY e.ts DESC
                     LIMIT 1`,
                    ["u1"],
                );
                const ghostPlan = queryPlan(
                    db,
                    `EXPLAIN QUERY PLAN
                     SELECT e.* FROM memory_events e
                     LEFT JOIN memory_state s ON s.event_id = e.id
                     WHERE e.user_id = ? AND e.type = 'ghost-context'
                       AND COALESCE(s.status, 'live') IN ('live', 'resumed')
                     ORDER BY e.ts DESC
                     LIMIT ?`,
                    ["u1", 12],
                );

                // Pending ask resolution and active ghost listing both drive the user's next turn.
                // Keep them on indexed reads so a larger single brain.db still behaves predictably.
                expect(askPlan).toContain("idx_events_user_type_ts");
                expect(askPlan).toContain("idx_events_parent_type");
                expect(ghostPlan).toContain("idx_events_user_type_ts");
            } finally {
                db.close();
            }
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

    test("patchGhostContent fails loudly on corrupt ghost content", async () => {
        const { store, dir } = await freshStore();
        try {
            const ts = Date.UTC(2026, 4, 13, 0, 0, 0);
            store.appendEvent({
                id: "ghost-corrupt",
                ts,
                userId: "u1",
                type: MemoryEventType.GhostContext,
                content: { reason: "ask" },
            });
            store.close();
            const db = new Database(join(dir, "brain.db"));
            try {
                db.run("UPDATE memory_events SET content = ? WHERE id = ?", ["{", "ghost-corrupt"]);
            } finally {
                db.close();
            }
            await store.open();

            expect(() => store.patchGhostContent("ghost-corrupt", { resumed: true })).toThrow(
                "Invalid ghost-context content JSON",
            );
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

    test("stores summary-first task plans, forks and scene records in brain.db", async () => {
        const { store } = await freshStore();
        try {
            store.writeTaskPlan({
                id: "plan-1",
                userId: "u1",
                title: "Release plan",
                summary: "Track release readiness.",
                status: TaskPlanStatus.InProgress,
                progress: 0.5,
                stepCount: 1,
                completedStepCount: 0,
                step: [{ id: "s1", title: "Run checks", status: TaskPlanStatus.Planned, order: 0 }],
                createdAt: "2026-05-16T00:00:00.000Z",
                updatedAt: "2026-05-16T00:00:00.000Z",
                sourceEventId: "episode-1",
            });
            store.writeContextFork({
                id: "fork-1",
                userId: "u1",
                title: "Installer fork",
                summary: "Isolate installer decisions.",
                scopeSummary: "Installer files only.",
                maxContextTokens: 12000,
                inheritedEventIds: ["episode-1"],
                createdAt: "2026-05-16T00:00:00.000Z",
                updatedAt: "2026-05-16T00:00:00.000Z",
                sourceEventId: "episode-1",
            });
            store.writeSceneRecord({
                id: "scene-1",
                userId: "u1",
                kind: SceneRecordKind.DeepThink,
                title: "Planning scene",
                summary: "The plan was created after analysis.",
                visibleFacts: ["plan exists"],
                openQuestions: [],
                sourceEventId: "episode-1",
                createdAt: "2026-05-16T00:00:00.000Z",
                updatedAt: "2026-05-16T00:00:00.000Z",
            });

            expect(store.listTaskPlans({ userId: "u1", sourceEventId: "episode-1" })[0]?.step?.[0]?.title).toBe(
                "Run checks",
            );
            expect(store.listContextForks({ userId: "u1", sourceEventId: "episode-1" })[0]?.maxContextTokens).toBe(
                12000,
            );
            expect(store.getContextFork("fork-1")?.scopeSummary).toBe("Installer files only.");
            expect(store.listSceneRecords({ userId: "u1", sourceEventId: "episode-1" })[0]?.visibleFacts).toEqual([
                "plan exists",
            ]);
        } finally {
            store.close();
        }
    });

    test("stores explicit project registry records", async () => {
        const { store } = await freshStore();
        try {
            const now = Date.now();
            const project: ProjectRecord = {
                id: "project-1",
                userId: "u1",
                title: "Alpha",
                goal: "Ship alpha",
                projectDir: "/tmp/alpha",
                projectMemoryDir: "/tmp/alpha/.flyflor/memory",
                createdAt: now,
                updatedAt: now,
                lastUsedAt: now,
                useCount: 1,
            };
            store.upsertProject(project);
            expect(store.getProject("project-1")?.projectDir).toBe("/tmp/alpha");
            expect(store.listProjects({ userId: "u1" })[0]?.title).toBe("Alpha");
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

function queryPlan(db: Database, sql: string, values: Array<string | number | null>): string {
    const rows = db.query(sql).all(...values) as Array<{ detail: string }>;
    return rows.map((row) => row.detail).join("\n");
}

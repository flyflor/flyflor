import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
import {
    MemoryEventType,
    ReplayRecordKind,
    TaskPlanStatus,
} from "../src/protocol/contracts/index.ts";

const root = join(tmpdir(), `flyflor-archive-test-${Date.now()}`);
const brainPath = join(root, "brain.db");

beforeAll(async () => {
    await mkdir(root, { recursive: true });
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    store.appendEvent({
                ownerKey: "scope:test",
                id: "e-old-1",
        ts: Date.UTC(2026, 3, 15),
        sourceKey: "u1",
        type: MemoryEventType.Event,
        content: { text: "old-1" },
    });
    store.appendEvent({
                ownerKey: "scope:test",
                id: "e-old-2",
        ts: Date.UTC(2026, 3, 16),
        sourceKey: "u1",
        type: MemoryEventType.Event,
        content: { text: "old-2" },
    });
    store.writeSummary({
        id: "summary-old",
        timeRange: "month",
        bucketKey: "2026-04",
        content: "april summary",
        createdAt: Date.UTC(2026, 3, 30),
    });
    store.writeContextFork({
        id: "fork-old",
        ownerKey: "scope:test",
        sourceKey: "u1",
        title: "Archived fork",
        summary: "Fork summary",
        continuitySummary: "Archived scope only.",
        maxContextTokens: 12000,
        inheritedEventIds: ["e-old-1"],
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        sourceEventId: "e-old-1",
    });
    store.writeTaskPlan({
        id: "plan-old",
        ownerKey: "scope:test",
        sourceKey: "u1",
        title: "Archived plan",
        summary: "Plan summary",
        status: TaskPlanStatus.InProgress,
        progress: 0.5,
        stepCount: 1,
        completedStepCount: 0,
        step: [{ id: "step-old", title: "Replay archive", status: TaskPlanStatus.Planned, order: 0 }],
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        sourceEventId: "e-old-1",
    });
    store.writeReplayRecord({
        id: "replay-old",
        ownerKey: "scope:test",
        sourceKey: "u1",
        kind: ReplayRecordKind.DeepThink,
        title: "Archived replay",
        summary: "Replay summary",
        visibleFacts: ["archive keeps replay"],
        openQuestions: [],
        contextForkId: "fork-old",
        taskPlanId: "plan-old",
        sourceEventId: "e-old-1",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
    });
    store.close();

    const db = new Database(brainPath);
    try {
        db.prepare("INSERT OR REPLACE INTO brain_meta(key, value) VALUES (?1, ?2)").run("live_month_key", "2026-04");
    } finally {
        db.close();
    }
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("scripts/brain.archive.ts", () => {
    test("seals a stale live brain.db into a full monthly archive db", () => {
        const proc = spawnSync(
            "bun",
            ["run", "scripts/brain.archive.ts", "--brain", brainPath, "--months", "1"],
            { cwd: process.cwd(), encoding: "utf8" },
        );
        if (proc.status !== 0) {
            throw new Error(`archive script exited ${proc.status}: ${proc.stderr}`);
        }

        const archivePath = join(root, "brain", "archive", "brain.2026-04.db");
        const archiveDb = new Database(archivePath, { readonly: true });
        try {
            const eventIds = (archiveDb.query("SELECT id FROM memory_events ORDER BY id").all() as Array<{ id: string }>).map(
                (row) => row.id,
            );
            const summaryIds = (
                archiveDb.query("SELECT id FROM memory_summary ORDER BY id").all() as Array<{ id: string }>
            ).map((row) => row.id);
            const forkIds = (archiveDb.query("SELECT id FROM context_forks ORDER BY id").all() as Array<{ id: string }>).map(
                (row) => row.id,
            );
            const taskPlanIds = (
                archiveDb.query("SELECT id FROM task_plans ORDER BY id").all() as Array<{ id: string }>
            ).map((row) => row.id);
            const replayIds = (
                archiveDb.query("SELECT id FROM replay_records ORDER BY id").all() as Array<{ id: string }>
            ).map((row) => row.id);
            expect(eventIds).toEqual(["e-old-1", "e-old-2"]);
            expect(summaryIds).toEqual(["summary-old"]);
            expect(forkIds).toEqual(["fork-old"]);
            expect(taskPlanIds).toEqual(["plan-old"]);
            expect(replayIds).toEqual(["replay-old"]);
        } finally {
            archiveDb.close();
        }

        const liveDb = new Database(brainPath, { readonly: true });
        try {
            const storedMonth = liveDb
                .query<{ value: string | null }, [string]>("SELECT value FROM brain_meta WHERE key = ?1")
                .get("live_month_key")?.value;
            const liveCount = (liveDb.query("SELECT COUNT(*) AS count FROM memory_events").get() as { count: number }).count;
            expect(storedMonth).toBeDefined();
            expect(liveCount).toBe(0);
        } finally {
            liveDb.close();
        }

        const reopened = new BrainStore({ dbPath: brainPath });
        return reopened.open().then(() => {
            try {
                // Archive catalog locators are the cross-shard replay index. These
                // reads must work after the live db has been replaced with a fresh shard.
                expect(reopened.getContextFork("fork-old")?.continuitySummary).toBe("Archived scope only.");
                expect(reopened.listTaskPlans({ sourceEventId: "e-old-1" })[0]?.id).toBe("plan-old");
                expect(reopened.listReplayRecords({ sourceEventId: "e-old-1" })[0]?.visibleFacts).toEqual([
                    "archive keeps replay",
                ]);
            } finally {
                reopened.close();
            }
        });
    });
});

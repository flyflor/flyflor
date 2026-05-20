import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
import { MemoryEventType } from "../src/protocol/contracts/index.ts";

const root = join(tmpdir(), `flyflor-archive-test-${Date.now()}`);
const brainPath = join(root, "brain.db");

beforeAll(async () => {
    await mkdir(root, { recursive: true });
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    store.appendEvent({
        id: "e-old-1",
        ts: Date.UTC(2026, 3, 15),
        userId: "u1",
        type: MemoryEventType.Event,
        content: { text: "old-1" },
    });
    store.appendEvent({
        id: "e-old-2",
        ts: Date.UTC(2026, 3, 16),
        userId: "u1",
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
            expect(eventIds).toEqual(["e-old-1", "e-old-2"]);
            expect(summaryIds).toEqual(["summary-old"]);
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
    });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { BrainStore } from "../src/neural/memory/brain.store.ts";
import {
    MemoryEventStatus,
    MemoryEventType,
} from "../src/protocol/contracts/index.ts";

const root = join(tmpdir(), `flyflor-archive-test-${Date.now()}`);
const brainPath = join(root, "brain.db");

beforeAll(async () => {
    await mkdir(root, { recursive: true });
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    const oldTs = Date.UTC(2024, 0, 15);
    const recentTs = Date.now();
    await store.appendEvent({
        id: "e-old-arch",
        ts: oldTs,
        userId: "u1",
        type: MemoryEventType.Event,
        content: { text: "old archived" },
    });
    await store.appendEvent({
        id: "e-old-live",
        ts: oldTs,
        userId: "u1",
        type: MemoryEventType.Event,
        content: { text: "old still live" },
    });
    await store.appendEvent({
        id: "e-new",
        ts: recentTs,
        userId: "u1",
        type: MemoryEventType.Event,
        content: { text: "recent" },
    });
    await store.upsertState("e-old-arch", { status: MemoryEventStatus.Archived });
    await store.writeSummary({
        id: "s-old",
        timeRange: "month",
        bucketKey: "2024-01",
        content: "old month",
        createdAt: oldTs,
    });
    await store.close();
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("scripts/brain.archive.ts", () => {
    test("moves archived events older than cutoff into per-month archive db", () => {
        const proc = spawnSync(
            "bun",
            [
                "run",
                "scripts/brain.archive.ts",
                "--brain",
                brainPath,
                "--months",
                "1",
            ],
            { cwd: process.cwd(), encoding: "utf8" },
        );
        if (proc.status !== 0) {
            throw new Error(
                `archive script exited ${proc.status}: ${proc.stderr}`,
            );
        }

        const live = new Database(brainPath, { readonly: true });
        const liveIds = (
            live.query("SELECT id FROM memory_events ORDER BY id").all() as {
                id: string;
            }[]
        ).map((r) => r.id);
        const liveSummaries = (
            live
                .query("SELECT id FROM memory_summary ORDER BY id")
                .all() as { id: string }[]
        ).map((r) => r.id);
        live.close();

        expect(liveIds).toEqual(["e-new", "e-old-live"]);
        expect(liveSummaries).toEqual([]);

        const archivePath = join(root, "archive", "brain.2024-01.db");
        const arch = new Database(archivePath, { readonly: true });
        const archIds = (
            arch.query("SELECT id FROM memory_events ORDER BY id").all() as {
                id: string;
            }[]
        ).map((r) => r.id);
        const archStateStatus = (
            arch
                .query(
                    "SELECT status FROM memory_state WHERE event_id = 'e-old-arch'",
                )
                .get() as { status: string } | null
        )?.status;
        const archSummaryIds = (
            arch
                .query("SELECT id FROM memory_summary ORDER BY id")
                .all() as { id: string }[]
        ).map((r) => r.id);
        arch.close();

        expect(archIds).toEqual(["e-old-arch"]);
        expect(archStateStatus).toBe(MemoryEventStatus.Archived);
        expect(archSummaryIds).toEqual(["s-old"]);
    });
});

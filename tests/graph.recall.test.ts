import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteGraphStore } from "../src/cognitive/hippocampus/memory/graph/index.ts";

describe("SQLiteGraphStore recall accounting", () => {
    test("recallMemoryNodes increments recallCount and lastAccessedAt for returned nodes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-recall-"));
        const store = new SQLiteGraphStore({ dbFile: join(root, "crystal.db") });
        try {
            await store.upsertMemoryNode({
                id: "node-1",
                ownerKey: "fork:test-fork",
                symbols: ["alpha", "beta"],
                summary: "alpha beta summary",
                embedding: [1, 0, 0, 0],
                confidence: 0.9,
                evidenceCount: 2,
                importance: 0.8,
                updatedAt: Date.UTC(2026, 4, 1, 0, 0, 0),
                recallCount: 0,
            });

            const recalled = await store.recallMemoryNodes({
                ownerKey: "fork:test-fork",
                embedding: [1, 0, 0, 0],
                symbols: ["alpha"],
                limit: 1,
            });
            expect(recalled).toHaveLength(1);
            expect(recalled[0]?.recallCount).toBe(1);
            expect(typeof recalled[0]?.lastAccessedAt).toBe("number");

            const extremes = await store.listRecallExtremes({
                ownerKey: "fork:test-fork",
                topN: 1,
                bottomN: 1,
            });
            expect(extremes.tops[0]?.id).toBe("node-1");
            expect(extremes.tops[0]?.recallCount).toBe(1);
            expect(typeof extremes.tops[0]?.lastAccessedAt).toBe("number");
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("recallSkills increments recallCount and lastVerifiedAt for returned gems", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-skill-recall-"));
        const store = new SQLiteGraphStore({ dbFile: join(root, "crystal.db") });
        try {
            await store.upsertGem({
                id: "gem-1",
                ownerKey: "fork:test-fork",
                symbols: ["deploy", "release"],
                summary: "deploy release checklist",
                embedding: [1, 0, 0, 0],
                importance: 0.85,
                confidence: 0.92,
                support: 3,
                protected: false,
                updatedAt: Date.UTC(2026, 4, 1, 0, 0, 0),
                recallCount: 0,
                status: "active",
            });

            const recalled = await store.recallSkills({
                ownerKey: "fork:test-fork",
                embedding: [1, 0, 0, 0],
                symbols: ["deploy"],
                limit: 1,
            });
            expect(recalled).toHaveLength(1);
            expect(recalled[0]?.recallCount).toBe(1);
            expect(typeof recalled[0]?.lastVerifiedAt).toBe("number");

            const driftCandidates = await store.listGemDriftCandidates({
                ownerKey: "fork:test-fork",
                nowMs: Date.now(),
                minContradictionCount: 99,
                maxStaleMs: 1,
                maxConfidence: 0,
                limit: 1,
            });
            expect(driftCandidates).toEqual([]);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

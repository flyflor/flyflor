import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteGraphStore } from "../src/cognitive/hippocampus/memory/graph/index.ts";

describe("SQLiteGraphStore recall accounting", () => {
    test("drops legacy graph tables without owner_key before dream-style owner queries", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-legacy-owner-"));
        const dbFile = join(root, "crystal.db");
        const legacy = new Database(dbFile);
        try {
            legacy.exec(`
                CREATE TABLE graph_gems (
                    id TEXT PRIMARY KEY,
                    symbols_json TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    embedding_json TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    support INTEGER NOT NULL,
                    protected INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
            `);
            legacy.run(
                "INSERT INTO graph_gems (id, symbols_json, summary, embedding_json, confidence, support, protected, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ["legacy-gem", "[\"old\"]", "old gem", "[1,0,0,0]", 0.2, 1, 0, 1],
            );
        } finally {
            legacy.close();
        }

        const store = new SQLiteGraphStore({ dbFile });
        try {
            const rows = await store.listGemDriftCandidates({
                ownerKey: "turn:test",
                nowMs: Date.UTC(2026, 4, 23, 0, 0, 0),
                minContradictionCount: 1,
                maxStaleMs: 1,
                maxConfidence: 1,
                limit: 10,
            });
            expect(rows).toEqual([]);

            const db = new Database(dbFile, { readonly: true });
            try {
                const columns = db.query("PRAGMA table_info(graph_gems)").all() as Array<{ name: string }>;
                expect(columns.map((column) => column.name)).toContain("owner_key");
                const legacyRows = db.query("SELECT id FROM graph_gems").all();
                expect(legacyRows).toEqual([]);
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("recallMemoryNodes increments recallCount and lastAccessedAt for returned nodes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-recall-"));
        const dbFile = join(root, "crystal.db");
        const store = new SQLiteGraphStore({ dbFile });
        try {
            const recallNow = Date.UTC(2026, 4, 2, 0, 0, 0);
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
                nowMs: recallNow,
            });
            expect(recalled).toHaveLength(1);
            expect(recalled[0]?.recallCount).toBe(1);
            expect(recalled[0]?.lastAccessedAt).toBe(recallNow);

            const extremes = await store.listRecallExtremes({
                ownerKey: "fork:test-fork",
                topN: 1,
                bottomN: 1,
            });
            expect(extremes.tops[0]?.id).toBe("node-1");
            expect(extremes.tops[0]?.recallCount).toBe(1);
            expect(extremes.tops[0]?.lastAccessedAt).toBe(recallNow);

            const db = new Database(dbFile, { readonly: true });
            try {
                const row = db
                    .query<{ last_accessed_at: number | null }, [string]>(
                        "SELECT last_accessed_at FROM graph_memory_nodes WHERE id = ?1",
                    )
                    .get("node-1");
                expect(row?.last_accessed_at).toBe(recallNow);
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("recallSkills increments recallCount and lastVerifiedAt for returned gems", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-skill-recall-"));
        const dbFile = join(root, "crystal.db");
        const store = new SQLiteGraphStore({ dbFile });
        try {
            const recallNow = Date.UTC(2026, 4, 2, 0, 0, 0);
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
                nowMs: recallNow,
            });
            expect(recalled).toHaveLength(1);
            expect(recalled[0]?.recallCount).toBe(1);
            expect(recalled[0]?.lastVerifiedAt).toBe(recallNow);

            const db = new Database(dbFile, { readonly: true });
            try {
                const row = db
                    .query<{ last_verified_at: number | null }, [string]>(
                        "SELECT last_verified_at FROM graph_gems WHERE id = ?1",
                    )
                    .get("gem-1");
                expect(row?.last_verified_at).toBe(recallNow);
            } finally {
                db.close();
            }

            const driftCandidates = await store.listGemDriftCandidates({
                ownerKey: "fork:test-fork",
                nowMs: recallNow,
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

    test("decay sweep persists the injected scheduler clock", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-decay-clock-"));
        const dbFile = join(root, "crystal.db");
        const store = new SQLiteGraphStore({ dbFile });
        try {
            const oldTs = Date.UTC(2026, 4, 1, 0, 0, 0);
            const sweepNow = Date.UTC(2026, 4, 3, 0, 0, 0);
            await store.upsertMemoryNode({
                id: "node-decay",
                ownerKey: "fork:test-fork",
                symbols: ["decay"],
                summary: "decay target",
                embedding: [1, 0, 0, 0],
                confidence: 0.9,
                evidenceCount: 2,
                importance: 0.8,
                updatedAt: oldTs,
            });
            await store.upsertGem({
                id: "gem-decay",
                ownerKey: "fork:test-fork",
                symbols: ["decay"],
                summary: "decay skill",
                embedding: [1, 0, 0, 0],
                confidence: 0.9,
                support: 2,
                protected: false,
                importance: 0.8,
                updatedAt: oldTs,
                status: "active",
            });

            const result = await store.applyDecaySweep({
                ownerKey: "fork:test-fork",
                nowMs: sweepNow,
                decayMemoryNode: () => 0.4,
                decayGem: () => 0.5,
            });
            expect(result).toEqual({ memoryNodes: 1, gems: 1 });

            const db = new Database(dbFile, { readonly: true });
            try {
                const node = db
                    .query<{ updated_at: number; importance: number }, [string]>(
                        "SELECT updated_at, importance FROM graph_memory_nodes WHERE id = ?1",
                    )
                    .get("node-decay");
                const gem = db
                    .query<{ updated_at: number; importance: number }, [string]>(
                        "SELECT updated_at, importance FROM graph_gems WHERE id = ?1",
                    )
                    .get("gem-decay");
                expect(node?.updated_at).toBe(sweepNow);
                expect(node?.importance).toBeCloseTo(0.4);
                expect(gem?.updated_at).toBe(sweepNow);
                expect(gem?.importance).toBeCloseTo(0.5);
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("vector recall uses deterministic resource tie-breakers", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-recall-tie-"));
        const dbFile = join(root, "crystal.db");
        const store = new SQLiteGraphStore({ dbFile });
        try {
            const recallNow = Date.UTC(2026, 4, 2, 0, 0, 0);
            const updatedAt = Date.UTC(2026, 4, 1, 0, 0, 0);
            await store.upsertMemoryNode({
                id: "node-b",
                ownerKey: "fork:test-fork",
                symbols: ["same"],
                summary: "same",
                embedding: [1, 0, 0, 0],
                confidence: 0.8,
                evidenceCount: 1,
                importance: 0.7,
                updatedAt,
            });
            await store.upsertMemoryNode({
                id: "node-a",
                ownerKey: "fork:test-fork",
                symbols: ["same"],
                summary: "same",
                embedding: [1, 0, 0, 0],
                confidence: 0.8,
                evidenceCount: 1,
                importance: 0.7,
                updatedAt,
            });

            const recalled = await store.recallMemoryNodes({
                ownerKey: "fork:test-fork",
                embedding: [1, 0, 0, 0],
                symbols: ["same"],
                limit: 2,
                nowMs: recallNow,
            });
            expect(recalled.map((row) => row.id)).toEqual(["node-a", "node-b"]);
            expect(recalled.map((row) => row.lastAccessedAt)).toEqual([recallNow, recallNow]);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    test("forgetting audit edges persist the injected mutation clock", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-graph-forget-clock-"));
        const dbFile = join(root, "crystal.db");
        const store = new SQLiteGraphStore({ dbFile });
        try {
            const nowMs = Date.UTC(2026, 4, 4, 0, 0, 0);
            await store.upsertMemoryNode({
                id: "left",
                ownerKey: "fork:test-fork",
                symbols: ["left"],
                summary: "left",
                embedding: [1, 0, 0, 0],
                confidence: 0.9,
                evidenceCount: 1,
                importance: 0.7,
                updatedAt: nowMs - 1000,
            });
            await store.upsertMemoryNode({
                id: "right",
                ownerKey: "fork:test-fork",
                symbols: ["right"],
                summary: "right",
                embedding: [0, 1, 0, 0],
                confidence: 0.9,
                evidenceCount: 1,
                importance: 0.7,
                updatedAt: nowMs - 1000,
            });

            const applied = await store.applyContradictionAudit({
                table: "memory_node",
                id: "left",
                confidenceMultiplier: 0.8,
                contradictionDelta: 1,
                nowMs,
                relateWith: { table: "memory_node", id: "right" },
            });
            expect(applied).toBe(true);

            const db = new Database(dbFile, { readonly: true });
            try {
                const edge = db
                    .query<{ at: number | null; created_at: number }, [string]>(
                        "SELECT at, created_at FROM graph_edges WHERE id = ?1",
                    )
                    .get("memory_node:left:contradicts:memory_node:right");
                expect(edge).toEqual({ at: nowMs, created_at: nowMs });
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

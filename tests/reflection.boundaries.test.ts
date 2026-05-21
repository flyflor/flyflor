import { describe, expect, test } from "bun:test";
import { CrystalMemoryComponent, InMemoryCrystalMemoryStore } from "../src/cognitive/crystal/memory/index.ts";
import { buildReflectionCandidate, crystallizeCandidate, evidence, recallCrystalGems } from "../src/cognitive/crystal/index.ts";
import { MemoryKind } from "../src/protocol/contracts/index.ts";
import type { CrystalMemoryConfig } from "../src/config/index.ts";
import type { MemoryRecord } from "../src/cognitive/hippocampus/memory/types.ts";

describe("Crystal memory boundaries", () => {
    test("builds dynamic buckets from evidence instead of a fixed taxonomy", () => {
        const candidate = buildReflectionCandidate({
            id: "candidate-a",
            sourceId: "source-a",
            sourceKind: "reflection-worker",
            content:
                "When a task is blocked by missing facts, summarize the exact blockers and return them to the user.",
            createdAt: "2026-05-10T00:00:00.000Z",
            symbols: ["blocked-task", "user-return"],
            coordinates: {
                blocker: 0.9,
                evidence: 0.8,
            },
            evidence: [evidence("verified", 0.9, "test-a", "verified by boundary test")],
        });

        expect(candidate.bucket).toStartWith("bucket-");
        expect(candidate.symbols).toContain("blocked-task");
        expect(candidate.coordinates.blocker).toBe(0.9);

        const crystallized = crystallizeCandidate(candidate);
        expect(crystallized?.gem.bucket).toBe(candidate.bucket);
        expect(crystallized?.gem.method).toContain("missing facts");
    });

    test("recalls crystallized gems through generated symbols and evidence score", async () => {
        const store = new InMemoryCrystalMemoryStore();
        const controller = new CrystalMemoryComponent(crystalConfig(), store);

        await controller.recordTurn({
            now: "2026-05-10T00:00:00.000Z",
            candidates: [],
            promoted: [
                memoryRecord(
                    "memory-a",
                    "When blackboard discussion is blocked, return a numbered blocker list to the user instead of inventing facts.",
                ),
            ],
            historyEntries: [],
        });

        const results = await controller.recall({
            query: "blackboard blocked missing facts numbered blockers",
            scope: "stdio:test",
            limit: 4,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]?.record.kind).toBe(MemoryKind.Gem);
        expect(results[0]?.record.content).toContain("blocker");
        expect(results[0]?.record.metadata).toMatchObject({
            recallReasons: expect.any(Array),
            recallEvidence: {
                bucketMatch: expect.any(Number),
                symbolOverlap: expect.any(Number),
                coordinateSimilarity: expect.any(Number),
                confidence: expect.any(Number),
            },
        });
    });

    test("core recall does not require configured buckets", () => {
        const first = crystallizeCandidate(
            buildReflectionCandidate({
                id: "candidate-b",
                sourceId: "source-b",
                sourceKind: "reflection-worker",
                content: "Use evidence-backed blocker summaries for impossible requests.",
                createdAt: "2026-05-10T00:00:00.000Z",
                symbols: ["evidence", "blocker", "summary"],
                evidence: [evidence("verified", 1, "test-b", "verified")],
            }),
        );
        if (!first) {
            throw new Error("expected crystallized gem");
        }

        const results = recallCrystalGems(
            {
                query: "blocker summary",
                symbols: ["blocker", "summary"],
                limit: 1,
            },
            [first.gem],
        );

        expect(results).toHaveLength(1);
        expect(results[0]?.score).toBeGreaterThan(0);
    });

    test("runtime reflection candidates must pass through candidate before crystallizing", async () => {
        const store = new InMemoryCrystalMemoryStore();
        const controller = new CrystalMemoryComponent(crystalConfig(), store);

        await controller.recordTurn({
            now: "2026-05-10T00:00:00.000Z",
            candidates: [],
            promoted: [],
            historyEntries: [],
            reflectionCandidates: [
                {
                    id: "runtime-reflection-a",
                    sourceId: "blackboard-turn-a",
                    sourceKind: "runtime-reflection",
                    content:
                        "When blackboard reaches a blocker, merge duplicate open issues before returning numbered questions.",
                    createdAt: "2026-05-10T00:00:00.000Z",
                    evidence: [evidence("blackboard-needs-user-reflection", 0.7, "turn-a", "verified blocker")],
                    method: "Merge duplicate open issues, then return a numbered blocker list.",
                    symbols: ["numbered-blockers", "dedupe-open-issues"],
                },
            ],
        });

        expect(store.candidates.size).toBe(1);
        expect(store.atoms.size).toBe(1);
        expect(store.gems.size).toBe(1);
    });

    test("garbage reflection candidates are stored as candidates without becoming gems", async () => {
        const store = new InMemoryCrystalMemoryStore();
        const controller = new CrystalMemoryComponent(crystalConfig(), store);

        await controller.recordTurn({
            now: "2026-05-10T00:00:00.000Z",
            candidates: [],
            promoted: [],
            historyEntries: [],
            reflectionCandidates: [
                {
                    id: "runtime-reflection-garbage",
                    sourceId: "direct-turn-garbage",
                    sourceKind: "runtime-reflection",
                    content: "asdf asdf asdf no reusable method",
                    createdAt: "2026-05-10T00:00:00.000Z",
                    evidence: [evidence("runtime-direct-reflection", 0, "turn-garbage", "unverified direct turn")],
                    method: "asdf",
                    symbols: ["asdf"],
                },
            ],
        });

        expect(store.candidates.size).toBe(1);
        expect(store.atoms.size).toBe(0);
        expect(store.gems.size).toBe(0);
    });

    test("explicit forget removes a gem from recall without deleting candidate provenance", async () => {
        const store = new InMemoryCrystalMemoryStore();
        const controller = new CrystalMemoryComponent(crystalConfig(), store);

        await controller.recordTurn({
            now: "2026-05-10T00:00:00.000Z",
            candidates: [],
            promoted: [
                memoryRecord(
                    "memory-forget-a",
                    "When facts are missing, return blockers before continuing execution.",
                ),
            ],
            historyEntries: [],
        });

        const [gemId] = [...store.gems.keys()];
        expect(gemId).toBeDefined();
        expect(await controller.forgetGem(gemId!)).toBe(true);
        expect(store.gems.has(gemId!)).toBe(false);
        expect(store.candidates.size).toBe(1);

        const recalled = await controller.recall({
            query: "missing facts blockers",
            scope: "stdio:test",
            limit: 4,
        });
        expect(recalled).toEqual([]);
        expect(await controller.forgetGem(gemId!)).toBe(false);
    });

});

function crystalConfig(): CrystalMemoryConfig {
    return {
        enabled: true,
        backend: "local",
        local: { dbFile: "" },
    };
}

function memoryRecord(id: string, content: string): MemoryRecord {
    return {
        id,
        kind: MemoryKind.Rule,
        content,
        scope: "global",
        importance: 0.9,
        confidence: 0.9,
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
    };
}

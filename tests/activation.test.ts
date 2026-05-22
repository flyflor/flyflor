import { describe, expect, test } from "bun:test";
import { spreadActivation, type ActivationCandidate } from "../src/cognitive/hippocampus/memory/recall/index.ts";
import { NullDreamWorker } from "../src/cognitive/hippocampus/memory/dream/index.ts";

const nowMs = 1_700_000_000_000;

function candidate(over: Partial<ActivationCandidate> = {}): ActivationCandidate {
    return {
        id: "c",
        embedding: [1, 0, 0, 0],
        concepts: [],
        importance: 0.5,
        createdAt: nowMs,
        ...over,
    };
}

describe("spreadActivation (no string match, pure resource metrics)", () => {
    test("ranks high cosine similarity above unrelated candidate", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [
                candidate({ id: "near", embedding: [0.95, 0.1, 0, 0] }),
                candidate({ id: "far", embedding: [0, 1, 0, 0] }),
            ],
            nowMs,
            topK: 5,
        });
        expect(result[0]?.id).toBe("near");
        expect(result[0]?.breakdown.similarity).toBeGreaterThan(result[1]?.breakdown.similarity ?? 1);
    });

    test("concept overlap boosts non-similar candidate", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: ["redis", "agent"],
            candidates: [
                candidate({ id: "concept-only", embedding: [0, 1, 0, 0], concepts: ["redis", "agent"] }),
                candidate({ id: "embed-only", embedding: [0.99, 0.1, 0, 0], concepts: [] }),
            ],
            nowMs,
            topK: 5,
            weights: { similarity: 0.2, concept: 0.7, importance: 0.1 },
        });
        expect(result[0]?.id).toBe("concept-only");
    });

    test("recency decays old episodes", () => {
        const oldMs = nowMs - 7 * 24 * 3_600_000;
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [
                candidate({ id: "fresh", embedding: [0.6, 0, 0, 0], importance: 0.6, createdAt: nowMs }),
                candidate({ id: "stale", embedding: [0.6, 0, 0, 0], importance: 0.95, createdAt: oldMs }),
            ],
            nowMs,
            topK: 5,
            halfLifeHours: 24,
        });
        expect(result[0]?.id).toBe("fresh");
        expect(result[0]?.breakdown.recency).toBeGreaterThan(result[1]?.breakdown.recency ?? 1);
    });

    test("topK limits results", () => {
        const candidates: ActivationCandidate[] = Array.from({ length: 20 }, (_, i) =>
            candidate({ id: `c${i}`, embedding: [20 - i, i + 1, 0, 0] }),
        );
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates,
            nowMs,
            topK: 3,
        });
        expect(result.length).toBeLessThanOrEqual(3);
    });

    test("equal resource scores use deterministic id ordering", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [
                candidate({ id: "memory-b", embedding: [1, 0, 0, 0], importance: 0.5, createdAt: nowMs }),
                candidate({ id: "memory-a", embedding: [1, 0, 0, 0], importance: 0.5, createdAt: nowMs }),
            ],
            nowMs,
            topK: 2,
        });
        expect(result.map((row) => row.id)).toEqual(["memory-a", "memory-b"]);
    });

    test("minScore filter drops weak candidates", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [candidate({ id: "weak", embedding: [0, 0.001, 0, 0], importance: 0 })],
            nowMs,
            topK: 5,
            minScore: 0.5,
        });
        expect(result.length).toBe(0);
    });

    test("missing embedding falls back to concept + importance only", () => {
        const result = spreadActivation({
            hotConcepts: ["x"],
            candidates: [candidate({ id: "concept", embedding: undefined, concepts: ["x"], importance: 0.8 })],
            nowMs,
            topK: 5,
        });
        expect(result[0]?.breakdown.similarity).toBe(0);
        expect(result[0]?.score).toBeGreaterThan(0);
    });

    test("mismatched embedding length yields zero similarity", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [candidate({ id: "x", embedding: [1, 0], importance: 1, createdAt: nowMs })],
            nowMs,
            topK: 5,
        });
        expect(result[0]?.breakdown.similarity).toBe(0);
    });

    test("zero candidates returns empty array", () => {
        const result = spreadActivation({
            hotConcepts: [],
            candidates: [],
            nowMs,
            topK: 5,
        });
        expect(result).toEqual([]);
    });

    test("topK 0 returns empty array", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [candidate({ id: "x", embedding: [1, 0, 0, 0] })],
            nowMs,
            topK: 0,
        });
        expect(result).toEqual([]);
    });

    test("clamps importance > 1 to 1 and < 0 to 0", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [
                candidate({ id: "high", embedding: [1, 0, 0, 0], importance: 5 }),
                candidate({ id: "neg", embedding: [1, 0, 0, 0], importance: -3 }),
            ],
            nowMs,
            topK: 5,
        });
        expect(result[0]?.breakdown.importance).toBe(1);
        expect(result[1]?.breakdown.importance).toBe(0);
    });

    test("zero halfLifeHours keeps recency at 1 (no decay)", () => {
        const result = spreadActivation({
            queryEmbedding: [1, 0, 0, 0],
            hotConcepts: [],
            candidates: [candidate({ id: "x", embedding: [1, 0, 0, 0], importance: 0.5, createdAt: 0 })],
            nowMs,
            topK: 5,
            halfLifeHours: 0,
        });
        expect(result[0]?.breakdown.recency).toBe(1);
    });
});

describe("DreamWorker stub", () => {
    test("NullDreamWorker runOnce returns zeroed metrics", async () => {
        const worker = new NullDreamWorker();
        const result = await worker.runOnce("u1", 100);
        expect(result).toEqual({
            scanned: 0,
            driftRepaired: 0,
            recallReinforced: 0,
            contradictionsFlagged: 0,
            reconsolidated: 0,
            skipped: 0,
        });
    });
});

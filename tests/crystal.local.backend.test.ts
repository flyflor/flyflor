import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrystalMemoryComponent, LocalCrystalMemoryStore } from "../src/cognitive/crystal/memory/index.ts";
import { evidence } from "../src/cognitive/crystal/reflection/index.ts";
import type { CrystalMemoryConfig } from "../src/config/index.ts";

describe("local crystal backend", () => {
    test("persists gems in crystal.db and recalls them through the in-process vector index", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-crystal-local-"));
        const store = new LocalCrystalMemoryStore({ dbFile: join(root, "crystal.db") });
        const svc = new CrystalMemoryComponent(config(root), store);

        try {
            await svc.recordTurn({
                now: "2026-05-15T00:00:00.000Z",
                candidates: [],
                promoted: [
                    {
                        id: "memory-rule-a",
                        kind: "rule",
                        content: "Always surface numbered blocker lists when facts are missing.",
                        scope: "global",
                        importance: 0.9,
                        confidence: 0.9,
                        createdAt: "2026-05-15T00:00:00.000Z",
                        updatedAt: "2026-05-15T00:00:00.000Z",
                    },
                ],
                historyEntries: [],
                reflectionCandidates: [
                    {
                        id: "reflection-a",
                        sourceId: "turn-a",
                        sourceKind: "runtime-reflection",
                        content: "Use numbered blocker lists when the answer depends on missing facts.",
                        createdAt: "2026-05-15T00:00:00.000Z",
                        evidence: [evidence("blackboard-converged-reflection", 0.8, "turn-a", "converged")],
                        method: "Use numbered blocker lists.",
                        title: "blocker-listing",
                        symbols: ["blocker", "numbered", "facts"],
                    },
                ],
            });

            const recalled = await svc.recall({
                query: "missing facts blocker list",
                scope: "stdio:test",
                limit: 3,
            });

            expect(recalled.length).toBeGreaterThan(0);
            expect(recalled[0]?.record.content).toContain("blocker");
            expect(recalled[0]?.record.metadata).toMatchObject({
                recallReasons: expect.any(Array),
                recallEvidence: {
                    bucketMatch: expect.any(Number),
                    symbolOverlap: expect.any(Number),
                    coordinateSimilarity: expect.any(Number),
                    confidence: expect.any(Number),
                },
            });

            const gemId = recalled[0]?.record.id;
            expect(gemId).toBeDefined();
            expect(await svc.forgetGem(gemId!)).toBe(true);
            const afterForget = await svc.recall({
                query: "missing facts blocker list",
                scope: "stdio:test",
                limit: 3,
            });
            expect(afterForget.map((item) => item.record.id)).not.toContain(gemId);
            expect(await svc.forgetGem(gemId!)).toBe(false);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

function config(root: string): CrystalMemoryConfig {
    return {
        enabled: true,
        backend: "local",
        local: { dbFile: join(root, "crystal.db") },
    };
}

/**
 * 端到端 reflection → skill 固化路径污染暴力测试。
 *
 * 验证目标：
 * - blackboard-converged 才能产生 skill；direct reflection（weight=0）只留 candidate；
 * - 同 bucket+symbols 多次反思应合并为单个 skill，support 累加，confidence 加权平均；
 * - 模型乱输出、空数组、非数组、JSON 损坏 → reflection 模块抛错或返回空，绝不污染存储；
 * - 高频/并发 recordTurn 应安全；store throws 不影响其他 candidate 处理。
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CrystalMemoryService, InMemoryCrystalMemoryStore } from "../src/crystal/memory/index.ts";
import {
    buildReflectionCandidate,
    crystallizeCandidate,
    evidence,
    mergeCrystalGem,
} from "../src/crystal/reflection/index.ts";
import { extractRuntimeReflectionCandidates } from "../src/agent/runtime/reflection.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { type ModelClient } from "../src/protocol/contracts/index.ts";
import type { CrystalMemoryConfig } from "../src/config/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

const CFG: CrystalMemoryConfig = {
    enabled: true,
    backend: "local",
    local: { dbFile: "" },
    surreal: {
        database: "test",
        enabled: false,
        internalUrl: "http://127.0.0.1:1",
        namespace: "flyflor",
        timeoutMs: 25,
    },
};

function makeService(): { svc: CrystalMemoryService; store: InMemoryCrystalMemoryStore } {
    const store = new InMemoryCrystalMemoryStore();
    return { svc: new CrystalMemoryService(CFG, store), store };
}

class StubModel implements ModelClient {
    constructor(private readonly raw: string) {}
    async generate(): Promise<string> {
        return this.raw;
    }
}

class FailingModel implements ModelClient {
    async generate(): Promise<string> {
        throw new Error("model-down");
    }
}

const NOW = "2026-05-12T00:00:00.000Z";

describe("reflection → skill consolidation (P0-5)", () => {
    test("blackboard-converged candidate becomes a skill", async () => {
        const { svc, store } = makeService();
        const result = await svc.recordTurn({
            requestId: "r1",
            now: NOW,
            candidates: [],
            promoted: [],
            historyEntries: [],
            reflectionCandidates: [
                {
                    id: "c1",
                    sourceId: "turn-1",
                    sourceKind: "runtime-reflection",
                    content: "Use bun test for fast iteration",
                    createdAt: NOW,
                    evidence: [evidence("blackboard-converged-reflection", 0.8, "turn-1", "converged")],
                    method: "Use bun test",
                    title: "bun-test-flow",
                    symbols: ["bun", "test"],
                },
            ],
        });
        expect(result.gems).toHaveLength(1);
        expect(store.gems.size).toBe(1);
        expect(store.atoms.size).toBe(1);
    });

    test("direct reflection (weight=0) creates candidate but no skill", async () => {
        const { svc, store } = makeService();
        const result = await svc.recordTurn({
            requestId: "r2",
            now: NOW,
            candidates: [],
            promoted: [],
            historyEntries: [],
            reflectionCandidates: [
                {
                    id: "c2",
                    sourceId: "turn-2",
                    sourceKind: "runtime-reflection",
                    content: "casual chat noise",
                    createdAt: NOW,
                    evidence: [evidence("runtime-direct-reflection", 0, "turn-2", "weak signal")],
                    method: "n/a",
                    symbols: ["chat"],
                },
            ],
        });
        expect(result.gems).toHaveLength(0);
        expect(store.gems.size).toBe(0);
        expect(store.candidates.size).toBe(1);
    });

    test("same bucket+symbols merge into single skill with growing support", async () => {
        const { svc, store } = makeService();
        for (let i = 0; i < 5; i++) {
            await svc.recordTurn({
                requestId: `r-${i}`,
                now: NOW,
                candidates: [],
                promoted: [],
                historyEntries: [],
                reflectionCandidates: [
                    {
                        id: `cm-${i}`,
                        sourceId: `turn-${i}`,
                        sourceKind: "runtime-reflection",
                        content: "Always run bun test before push",
                        createdAt: NOW,
                        evidence: [evidence("blackboard-converged-reflection", 0.8, `turn-${i}`, "converged")],
                        method: "bun test before push",
                        title: "ci-discipline",
                        symbols: ["bun", "test", "push"],
                    },
                ],
            });
        }
        expect(store.gems.size).toBe(1);
        const [only] = [...store.gems.values()];
        expect(only?.support).toBeGreaterThanOrEqual(5);
    });

    test("[chaos] model returns malformed JSON → extract throws (silently swallowed by runtime caller)", async () => {
        const model = new StubModel("not json at all");
        await expect(
            extractRuntimeReflectionCandidates(model, {
                answer: "ok",
                now: NOW,
                request: "q",
                requestId: "r",
            }),
        ).rejects.toThrow();
    });

    test("[chaos] model returns non-array JSON → extract throws", async () => {
        const model = new StubModel(`{"foo":1}`);
        await expect(
            extractRuntimeReflectionCandidates(model, {
                answer: "ok",
                now: NOW,
                request: "q",
                requestId: "r",
            }),
        ).rejects.toThrow();
    });

    test("[chaos] model returns empty array → no candidates", async () => {
        const model = new StubModel("[]");
        const out = await extractRuntimeReflectionCandidates(model, {
            answer: "ok",
            now: NOW,
            request: "q",
            requestId: "r",
        });
        expect(out).toEqual([]);
    });

    test("[chaos] model items missing method+title are filtered", async () => {
        const model = new StubModel(
            JSON.stringify([
                { symbols: ["x"] },
                { method: "do thing", title: "T", symbols: ["y"] },
                { coordinates: { a: 0.5 } },
            ]),
        );
        const out = await extractRuntimeReflectionCandidates(model, {
            answer: "ok",
            now: NOW,
            request: "q",
            requestId: "r",
        });
        expect(out).toHaveLength(1);
        expect(out[0]?.title).toBe("T");
    });

    test("[chaos] model fenced ```json block is parsed", async () => {
        const model = new StubModel(
            "```json\n[{\"method\":\"m\",\"title\":\"t\",\"symbols\":[\"a\"]}]\n```",
        );
        const out = await extractRuntimeReflectionCandidates(model, {
            answer: "ok",
            now: NOW,
            request: "q",
            requestId: "r",
        });
        expect(out).toHaveLength(1);
    });

    test("[chaos] model throws → extract propagates (caller catches)", async () => {
        const model = new FailingModel();
        await expect(
            extractRuntimeReflectionCandidates(model, {
                answer: "",
                now: NOW,
                request: "q",
                requestId: "r",
            }),
        ).rejects.toThrow(/model-down/);
    });

    test("[chaos] disabled crystal config → recordTurn no-op", async () => {
        const store = new InMemoryCrystalMemoryStore();
        const svc = new CrystalMemoryService(
            {
                enabled: false,
                backend: "local",
                local: { dbFile: "" },
                surreal: {
                    database: "test",
                    enabled: false,
                    internalUrl: "http://127.0.0.1:1",
                    namespace: "flyflor",
                    timeoutMs: 25,
                },
            },
            store,
        );
        const r = await svc.recordTurn({
            requestId: "r",
            now: NOW,
            candidates: [],
            promoted: [],
            historyEntries: [],
            reflectionCandidates: [
                {
                    id: "x",
                    sourceId: "x",
                    sourceKind: "runtime-reflection",
                    content: "hi",
                    createdAt: NOW,
                    evidence: [evidence("blackboard-converged-reflection", 0.8, "x", "x")],
                    method: "m",
                    title: "t",
                    symbols: ["s"],
                },
            ],
        });
        expect(r.gems).toEqual([]);
        expect(store.gems.size).toBe(0);
    });

    test("[chaos] mergeCrystalGem is associative-like under support weighting", () => {
        const base = buildReflectionCandidate({
            id: "k",
            sourceId: "k",
            sourceKind: "runtime-reflection",
            content: "merge test",
            createdAt: NOW,
            evidence: [evidence("blackboard-converged-reflection", 0.6, "k", "x")],
            symbols: ["m"],
            method: "m",
            title: "t",
        });
        const a = crystallizeCandidate(base)!;
        const b = crystallizeCandidate({
            ...base,
            evidence: [evidence("blackboard-converged-reflection", 1, "k", "x")],
        })!;
        const m1 = mergeCrystalGem(a.gem, b.gem);
        const m2 = mergeCrystalGem(undefined, m1);
        expect(m2.support).toBe(m1.support);
        expect(m2.confidence).toBeGreaterThan(0);
        expect(m2.evidenceScore).toBeGreaterThanOrEqual(a.gem.evidenceScore);
    });

    test("[chaos] high-frequency parallel recordTurn does not corrupt store", async () => {
        const { svc, store } = makeService();
        // 用相同 content 确保 extractSymbolTokens 派生符号一致 → 同 bucket+symbols → 同 skillId
        const tasks = Array.from({ length: 50 }, (_, i) =>
            svc.recordTurn({
                requestId: `p-${i}`,
                now: NOW,
                candidates: [],
                promoted: [],
                historyEntries: [],
                reflectionCandidates: [
                    {
                        id: `cp-${i}`,
                        sourceId: `s-${i}`,
                        sourceKind: "runtime-reflection",
                        content: `parallel item cluster-${i % 3}`,
                        createdAt: NOW,
                        evidence: [
                            evidence(
                                "blackboard-converged-reflection",
                                0.8,
                                `s-${i}`,
                                "converged",
                            ),
                        ],
                        method: `cluster-${i % 3}`,
                        title: `t-${i % 3}`,
                        symbols: [`sym-${i % 3}`],
                    },
                ],
            }),
        );
        const results = await Promise.all(tasks);
        expect(results.every((r) => r.gems.length === 1)).toBe(true);
        expect(store.candidates.size).toBe(50);
        expect(store.gems.size).toBeLessThanOrEqual(3);
    });

    test("[chaos] failing store on upsertGem is observed (caller may retry); no partial atom write side effects beyond atom write", async () => {
        const store = new InMemoryCrystalMemoryStore();
        let calls = 0;
        store.upsertGem = async () => {
            calls += 1;
            throw new Error("skill-upsert-down");
        };
        const svc = new CrystalMemoryService(CFG, store);
        await expect(
            svc.recordTurn({
                requestId: "r",
                now: NOW,
                candidates: [],
                promoted: [],
                historyEntries: [],
                reflectionCandidates: [
                    {
                        id: "c",
                        sourceId: "s",
                        sourceKind: "runtime-reflection",
                        content: "fail",
                        createdAt: NOW,
                        evidence: [evidence("blackboard-converged-reflection", 0.8, "s", "s")],
                        method: "m",
                        title: "t",
                        symbols: ["sx"],
                    },
                ],
            }),
        ).rejects.toThrow(/skill-upsert-down/);
        expect(calls).toBe(1);
        expect(store.gems.size).toBe(0);
    });

    test("[chaos] coordinates outside [0,1] are clamped on candidate build", () => {
        const c = buildReflectionCandidate({
            id: "c",
            sourceId: "s",
            sourceKind: "runtime-reflection",
            content: "x",
            createdAt: NOW,
            evidence: [],
            coordinates: { a: 5, b: -3, c: 0.7 },
        });
        for (const v of Object.values(c.coordinates)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    test("[chaos] crystallize returns undefined when evidence array is empty", () => {
        const c = buildReflectionCandidate({
            id: "c",
            sourceId: "s",
            sourceKind: "runtime-reflection",
            content: "x",
            createdAt: NOW,
            evidence: [],
            symbols: ["x"],
        });
        expect(crystallizeCandidate(c)).toBeUndefined();
    });
});

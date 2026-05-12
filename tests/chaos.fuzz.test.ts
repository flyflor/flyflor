/**
 * 暴力测试 + 垃圾数据污染 (chaos / fuzz)。
 *
 * 目标：把每个纯函数模块灌入大批随机/恶意/异常输入，确保：
 *   - 不抛异常；
 *   - 输出在合法范围（NaN/Infinity 被吃掉，得分在 [0,1]）；
 *   - 不退化（O(N²) 路径在 N=200 时仍能秒级完成）；
 *   - 决定性（同输入同输出）。
 */

import { describe, expect, test } from "bun:test";
import { LruCache } from "../src/neural/memory/lru.cache.ts";
import { spreadActivation } from "../src/neural/memory/activation.ts";
import {
    DecayLayer,
    decayImportance,
    reinforceImportance,
    DEFAULT_DECAY_PROFILES,
} from "../src/neural/memory/decay.ts";
import {
    dedupeGems,
    isContradiction,
    isStale,
    shouldMergeGems,
    type GemCandidate,
} from "../src/neural/memory/anti.bloat.ts";
import { parseConsolidationDecision } from "../src/neural/memory/consolidation.worker.ts";
import {
    detectClusterCandidate,
    detectExplicitIntent,
    detectSkillPromotion,
    ProjectTriggerKind,
} from "../src/agent/project/index.ts";
import type { EpisodeRecord } from "../src/neural/memory/redis.ts";

// ─── 随机源 (deterministic mulberry32) ─────────────────────────────
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function chaosNumber(r: () => number): number {
    const dice = Math.floor(r() * 12);
    switch (dice) {
        case 0:
            return Number.NaN;
        case 1:
            return Number.POSITIVE_INFINITY;
        case 2:
            return Number.NEGATIVE_INFINITY;
        case 3:
            return Number.MAX_SAFE_INTEGER;
        case 4:
            return Number.MIN_SAFE_INTEGER;
        case 5:
            return -1e300;
        case 6:
            return 1e300;
        case 7:
            return -0;
        case 8:
            return Number.EPSILON;
        case 9:
            return r() * 2 - 1; // typical
        case 10:
            return Math.floor(r() * 1_000_000);
        default:
            return r();
    }
}

function chaosVector(r: () => number, dim = 8): number[] {
    return Array.from({ length: dim }, () => chaosNumber(r));
}

function chaosString(r: () => number): string {
    const len = Math.floor(r() * 12);
    let out = "";
    for (let i = 0; i < len; i += 1) {
        out += String.fromCharCode(32 + Math.floor(r() * 95));
    }
    return out;
}

const POISONED_JSON: string[] = [
    "",
    "   ",
    "\u0000\u0000",
    "not json at all",
    "{",
    "}",
    '{ "decision":',
    '{"decision":"DROP TABLE users;"}',
    '{"decision":"reinforce","confidence":NaN}',
    '{"decision":"discard","confidence":-9}',
    '{"decision":"consolidate","confidence":1.5,"summary":"","symbols":[1,2,null]}',
    'garbage {"decision":"reinforce","confidence":0.5} trailing',
    '{"decision":["discard"]}',
    '["discard"]',
    "null",
    "true",
    '{"decision":"reinforce","confidence":"0.7"}',
    `{"decision":"consolidate","confidence":0.7,"symbols":${JSON.stringify(Array.from({ length: 200 }, (_, i) => `s${i}`))}}`,
    `{"decision":"consolidate","summary":"${"x".repeat(2000)}","confidence":0.5}`,
    "{}{}{}{}",
    "}{",
    `${"{".repeat(50)}"decision":"discard"${"}".repeat(50)}`,
];

// ─── LRU 暴力 ──────────────────────────────────────────────────────
describe("chaos: LruCache", () => {
    test("maxSize=0 totally disabled", () => {
        const c = new LruCache<number>({ maxSize: 0, ttlMs: 1000 });
        for (let i = 0; i < 100; i += 1) c.set(`k${i}`, i);
        expect(c.size).toBe(0);
        expect(c.get("k0")).toBeUndefined();
    });

    test("maxSize=1 evicts in FIFO", () => {
        const c = new LruCache<number>({ maxSize: 1, ttlMs: 60_000 });
        c.set("a", 1);
        c.set("b", 2);
        expect(c.get("a")).toBeUndefined();
        expect(c.get("b")).toBe(2);
    });

    test("ttlMs=0 means never observable", () => {
        const c = new LruCache<number>({ maxSize: 5, ttlMs: 0 });
        c.set("a", 1);
        expect(c.get("a")).toBeUndefined();
    });

    test("10k random ops never throws and bounds size", () => {
        const cap = 64;
        const c = new LruCache<number>({ maxSize: cap, ttlMs: 1_000 });
        const r = rng(42);
        let now = 0;
        for (let i = 0; i < 10_000; i += 1) {
            const op = Math.floor(r() * 4);
            const key = `k${Math.floor(r() * 200)}`;
            now += Math.floor(r() * 50);
            if (op === 0) c.set(key, i, now);
            else if (op === 1) c.get(key, now);
            else if (op === 2) c.delete(key);
            else c.stats();
            expect(c.size).toBeLessThanOrEqual(cap);
        }
        const stats = c.stats();
        expect(stats.hits + stats.misses).toBeGreaterThan(0);
        expect(stats.hitRate).toBeGreaterThanOrEqual(0);
        expect(stats.hitRate).toBeLessThanOrEqual(1);
    });

    test("clear resets stats", () => {
        const c = new LruCache<number>({ maxSize: 8, ttlMs: 1000 });
        c.set("a", 1);
        c.get("a");
        c.get("missing");
        c.clear();
        expect(c.stats()).toEqual({ hits: 0, misses: 0, hitRate: 0, size: 0 });
    });
});

// ─── decay 暴力 ────────────────────────────────────────────────────
describe("chaos: decay & reinforce", () => {
    test("reinforceImportance bounded in [0,1] for chaos input", () => {
        const r = rng(7);
        for (let i = 0; i < 5_000; i += 1) {
            const v = reinforceImportance(chaosNumber(r), chaosNumber(r));
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(Number.isFinite(v)).toBe(true);
        }
    });

    test("decayImportance bounded in [floor,1] and finite for chaos input", () => {
        const r = rng(11);
        const layers = Object.values(DecayLayer);
        for (let i = 0; i < 5_000; i += 1) {
            const layer = layers[Math.floor(r() * layers.length)] as DecayLayer;
            const profile = DEFAULT_DECAY_PROFILES[layer];
            const v = decayImportance({
                layer,
                importance: chaosNumber(r),
                updatedAt: chaosNumber(r),
                lastVerifiedAt: r() < 0.3 ? chaosNumber(r) : undefined,
                nowMs: chaosNumber(r),
            });
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(profile.floor);
            expect(v).toBeLessThanOrEqual(1.0001);
        }
    });

    test("decay is monotonic in age (Episode/MemoryNode)", () => {
        for (const layer of [DecayLayer.Episode, DecayLayer.MemoryNode]) {
            let prev = decayImportance({ layer, importance: 1, updatedAt: 0, nowMs: 0 });
            for (let h = 0; h < 240; h += 4) {
                const v = decayImportance({
                    layer,
                    importance: 1,
                    updatedAt: 0,
                    nowMs: h * 3_600_000,
                });
                expect(v).toBeLessThanOrEqual(prev + 1e-9);
                prev = v;
            }
        }
    });
});

// ─── anti-bloat 暴力 ───────────────────────────────────────────────
describe("chaos: anti-bloat", () => {
    test("dedupeGems handles 200 skills with NaN/dup ids without throwing", () => {
        const r = rng(99);
        const skills: GemCandidate[] = [];
        for (let i = 0; i < 200; i += 1) {
            skills.push({
                id: r() < 0.05 ? "dup" : `s${i}`,
                symbols: Array.from({ length: Math.floor(r() * 5) }, () => `tag${Math.floor(r() * 6)}`),
                embedding: chaosVector(r, 6),
                confidence: chaosNumber(r),
                evidenceCount: chaosNumber(r),
                protected: r() < 0.1,
            });
        }
        const result = dedupeGems(skills);
        // 每个 surviving 的 confidence/evidence 已被 sanitize
        for (const item of result) {
            expect(item.surviving.confidence).toBeGreaterThanOrEqual(0);
            expect(item.surviving.confidence).toBeLessThanOrEqual(1);
            expect(Number.isFinite(item.surviving.confidence)).toBe(true);
            expect(Number.isInteger(item.surviving.evidenceCount)).toBe(true);
            expect(item.surviving.evidenceCount).toBeGreaterThanOrEqual(0);
        }
        // dup id 只保留一份
        const allSurvivingIds = result.map((r) => r.surviving.id);
        const dupCount = allSurvivingIds.filter((id) => id === "dup").length;
        expect(dupCount).toBeLessThanOrEqual(1);
    });

    test("dedupeGems drops malformed entries (no id)", () => {
        const result = dedupeGems([
            { id: "", symbols: ["x"], embedding: [1, 0], confidence: 1, evidenceCount: 1 },
            // @ts-expect-error garbage
            null,
            // @ts-expect-error garbage
            { symbols: ["x"], embedding: [1, 0], confidence: 1, evidenceCount: 1 },
            { id: "ok", symbols: ["x"], embedding: [1, 0], confidence: 0.5, evidenceCount: 1 },
        ]);
        expect(result.length).toBe(1);
        expect(result[0]?.surviving.id).toBe("ok");
    });

    test("shouldMergeGems with NaN-poisoned vectors never throws/returns NaN", () => {
        const r = rng(123);
        for (let i = 0; i < 1_000; i += 1) {
            const out = shouldMergeGems(
                {
                    id: "a",
                    symbols: ["x", "y"],
                    embedding: chaosVector(r, 4),
                    confidence: chaosNumber(r),
                    evidenceCount: 1,
                },
                {
                    id: "b",
                    symbols: ["x", "y"],
                    embedding: chaosVector(r, 4),
                    confidence: chaosNumber(r),
                    evidenceCount: 1,
                },
            );
            expect(typeof out).toBe("boolean");
        }
    });

    test("isContradiction stays boolean for chaos input", () => {
        const r = rng(321);
        for (let i = 0; i < 1_000; i += 1) {
            const v = isContradiction({ embedding: chaosVector(r, 4) }, { embedding: chaosVector(r, 4) });
            expect(typeof v).toBe("boolean");
        }
    });

    test("isStale chaos numeric times", () => {
        const r = rng(555);
        for (let i = 0; i < 500; i += 1) {
            const v = isStale(chaosNumber(r), chaosNumber(r));
            expect(typeof v).toBe("boolean");
        }
    });
});

// ─── activation 暴力 ───────────────────────────────────────────────
describe("chaos: spreadActivation", () => {
    test("survives 500 random candidates with poisoned embeddings", () => {
        const r = rng(2024);
        const candidates = Array.from({ length: 500 }, (_, i) => ({
            id: `e${i}`,
            embedding: r() < 0.7 ? chaosVector(r, 6) : undefined,
            concepts: r() < 0.7 ? Array.from({ length: 4 }, () => chaosString(r)) : undefined,
            importance: chaosNumber(r),
            createdAt: chaosNumber(r),
        }));
        const out = spreadActivation({
            queryEmbedding: chaosVector(r, 6),
            hotConcepts: ["a", "b", "c"],
            candidates,
            nowMs: Date.now(),
            topK: 20,
        });
        expect(out.length).toBeLessThanOrEqual(20);
        for (const r of out) {
            expect(Number.isFinite(r.score)).toBe(true);
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.breakdown.importance).toBeGreaterThanOrEqual(0);
            expect(r.breakdown.importance).toBeLessThanOrEqual(1);
        }
        // 排序单调
        for (let i = 1; i < out.length; i += 1) {
            expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score);
        }
    });

    test("topK=0 returns empty", () => {
        const out = spreadActivation({
            hotConcepts: ["a"],
            candidates: [{ id: "x", importance: 1, createdAt: 0, concepts: ["a"] }],
            nowMs: 0,
            topK: 0,
        });
        expect(out).toEqual([]);
    });

    test("topK negative clamped to 0", () => {
        const out = spreadActivation({
            hotConcepts: ["a"],
            candidates: [{ id: "x", importance: 1, createdAt: 0, concepts: ["a"] }],
            nowMs: 0,
            topK: -10,
        });
        expect(out).toEqual([]);
    });

    test("empty candidates / empty hot concepts", () => {
        expect(spreadActivation({ hotConcepts: [], candidates: [], nowMs: 0, topK: 5 })).toEqual([]);
    });
});

// ─── parseConsolidationDecision 垃圾数据 ───────────────────────────
describe("chaos: parseConsolidationDecision (poisoned JSON)", () => {
    test("never throws on the poisoned-input corpus", () => {
        for (const input of POISONED_JSON) {
            const out = parseConsolidationDecision(input);
            expect(["reinforce", "consolidate", "discard"]).toContain(out.decision);
            expect(out.confidence).toBeGreaterThanOrEqual(0);
            expect(out.confidence).toBeLessThanOrEqual(1);
            expect(Number.isFinite(out.confidence)).toBe(true);
        }
    });

    test("symbols are clipped at 16", () => {
        const big = `{"decision":"consolidate","confidence":0.5,"symbols":${JSON.stringify(
            Array.from({ length: 100 }, (_, i) => `s${i}`),
        )}}`;
        const out = parseConsolidationDecision(big);
        expect(out.symbols!.length).toBe(16);
    });

    test("summary clipped at 500 chars", () => {
        const big = `{"decision":"consolidate","confidence":0.5,"summary":"${"x".repeat(2000)}"}`;
        const out = parseConsolidationDecision(big);
        expect(out.summary!.length).toBe(500);
    });

    test("random byte fuzz for 2000 iterations stays safe", () => {
        const r = rng(0xdead);
        for (let i = 0; i < 2_000; i += 1) {
            const len = Math.floor(r() * 200);
            let s = "";
            for (let j = 0; j < len; j += 1) s += String.fromCharCode(Math.floor(r() * 128));
            const out = parseConsolidationDecision(s);
            expect(typeof out.decision).toBe("string");
            expect(out.confidence).toBeGreaterThanOrEqual(0);
        }
    });
});

// ─── project triggers 垃圾数据 ─────────────────────────────────────
describe("chaos: project triggers", () => {
    test("detectExplicitIntent ignores garbage signal numbers", () => {
        const r = rng(77);
        for (let i = 0; i < 500; i += 1) {
            const out = detectExplicitIntent([
                {
                    action: "add",
                    target: "memory",
                    content: chaosString(r),
                    signals: {
                        projectIntent: chaosNumber(r),
                        eventIntent: chaosNumber(r),
                    },
                },
            ]);
            expect(Object.values(ProjectTriggerKind)).toContain(out.kind);
            expect(out.score).toBeGreaterThanOrEqual(0);
            expect(out.score).toBeLessThanOrEqual(1);
        }
    });

    test("detectClusterCandidate with chaos episodes never throws", () => {
        const r = rng(88);
        for (let trial = 0; trial < 100; trial += 1) {
            const n = Math.floor(r() * 12);
            const eps: EpisodeRecord[] = Array.from({ length: n }, (_, i) => ({
                episodeId: `ep${i}`,
                userId: "u",
                text: chaosString(r),
                concepts: [chaosString(r)],
                embedding: chaosVector(r, 4),
                importance: chaosNumber(r),
                stability: chaosNumber(r),
                sourceKind: r() < 0.3 ? "blackboard-converged" : "session-turn",
                createdAt: chaosNumber(r),
                metadata: {},
            }));
            const out = detectClusterCandidate({ concepts: ["x"], episodes: eps });
            expect(Object.values(ProjectTriggerKind)).toContain(out.kind);
            expect(out.score).toBeGreaterThanOrEqual(0);
            expect(out.score).toBeLessThanOrEqual(1);
        }
    });

    test("detectSkillPromotion chaos input bounded", () => {
        const r = rng(101);
        for (let i = 0; i < 500; i += 1) {
            const out = detectSkillPromotion({
                id: chaosString(r) || "x",
                support: chaosNumber(r),
                confidence: chaosNumber(r),
            });
            expect(Object.values(ProjectTriggerKind)).toContain(out.kind);
            expect(out.score).toBeGreaterThanOrEqual(0);
            expect(out.score).toBeLessThanOrEqual(1);
        }
    });
});

// ─── 决定性 (same input → same output) ─────────────────────────────
describe("chaos: determinism check", () => {
    test("spreadActivation deterministic for same input", () => {
        const input = {
            queryEmbedding: [0.1, 0.2, 0.3],
            hotConcepts: ["a", "b"],
            candidates: Array.from({ length: 30 }, (_, i) => ({
                id: `c${i}`,
                embedding: [Math.sin(i), Math.cos(i), 0.1 * i],
                concepts: i % 2 === 0 ? ["a"] : ["b"],
                importance: 0.5,
                createdAt: i * 1_000,
            })),
            nowMs: 100_000,
            topK: 10,
        };
        const a = spreadActivation(input);
        const b = spreadActivation(input);
        expect(a).toEqual(b);
    });
});

import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { LruCache } from "../src/neural/memory/lru.cache.ts";
import {
    ConsolidationDecisionKind,
    ConsolidationWorker,
    parseConsolidationDecision,
    type ConsolidationDecision,
} from "../src/neural/memory/consolidation.worker.ts";
import type { EpisodeRecord, RedisMemoryStore } from "../src/neural/memory/redis.ts";
import type { SurrealGraphStore } from "../src/neural/memory/surreal.graph.ts";
import { ModelRole, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

class CapturingSink implements EventSink {
    readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publish(evt: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push({ type: evt.type, payload: evt.payload });
    }
}

class StubModel implements ModelClient {
    constructor(private readonly responses: string[]) {}
    private idx = 0;
    async generate(_messages: ModelMessage[]): Promise<string> {
        const r = this.responses[this.idx] ?? this.responses[this.responses.length - 1] ?? "";
        this.idx += 1;
        return r;
    }
}

describe("LruCache (zero-dep, bun-compile safe)", () => {
    test("get returns undefined on miss", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        expect(cache.get("x")).toBeUndefined();
    });

    test("set then get returns value", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        expect(cache.get("a")).toBe("1");
    });

    test("evicts least-recently-used when at capacity", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        cache.set("b", "2");
        cache.get("a"); // a most recent
        cache.set("c", "3"); // evicts b
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe("1");
        expect(cache.get("c")).toBe("3");
    });

    test("ttl expiry returns undefined and frees slot", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 100 });
        cache.set("a", "1", 1_000);
        expect(cache.get("a", 1_050)).toBe("1");
        expect(cache.get("a", 2_000)).toBeUndefined();
    });

    test("delete removes entry", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        expect(cache.delete("a")).toBe(true);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.delete("a")).toBe(false);
    });

    test("clear empties cache and resets stats", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        cache.get("a");
        cache.get("missing");
        cache.clear();
        expect(cache.size).toBe(0);
        const stats = cache.stats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
    });

    test("re-set on existing key refreshes recency", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        cache.set("b", "2");
        cache.set("a", "1-updated"); // a now most recent
        cache.set("c", "3"); // evicts b
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe("1-updated");
    });

    test("stats hitRate reports expected ratio", () => {
        const cache = new LruCache<string>({ maxSize: 2, ttlMs: 1000 });
        cache.set("a", "1");
        cache.get("a");
        cache.get("a");
        cache.get("b"); // miss
        const stats = cache.stats();
        expect(stats.hits).toBe(2);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBeCloseTo(2 / 3, 5);
    });

    test("size 0 hitRate is 0", () => {
        const cache = new LruCache<string>({ maxSize: 1, ttlMs: 1000 });
        const stats = cache.stats();
        expect(stats.hitRate).toBe(0);
    });
});

describe("ConsolidationWorker (LLM-driven, no string match)", () => {
    test("parses reinforce decision", () => {
        const d = parseConsolidationDecision(
            JSON.stringify({ decision: "reinforce", confidence: 0.7, rationale: "recurring topic" }),
        );
        expect(d.decision).toBe(ConsolidationDecisionKind.Reinforce);
        expect(d.confidence).toBe(0.7);
    });

    test("parses consolidate decision with summary + symbols", () => {
        const d = parseConsolidationDecision(
            JSON.stringify({
                decision: "consolidate",
                confidence: 0.85,
                summary: "user is allergic to peanuts",
                symbols: ["allergy", "user-profile"],
            }),
        );
        expect(d.decision).toBe(ConsolidationDecisionKind.Consolidate);
        expect(d.symbols).toEqual(["allergy", "user-profile"]);
        expect(d.summary).toBe("user is allergic to peanuts");
    });

    test("falls back to reinforce on malformed output", () => {
        const d = parseConsolidationDecision("not json");
        expect(d.decision).toBe(ConsolidationDecisionKind.Reinforce);
        expect(d.confidence).toBe(0);
    });

    test("rejects unknown decision string", () => {
        const d = parseConsolidationDecision(
            JSON.stringify({ decision: "frobnicate", confidence: 1 }),
        );
        expect(d.decision).toBe(ConsolidationDecisionKind.Reinforce);
        expect(d.rationale).toBe("parse-failed");
    });

    test("filters non-string symbols", () => {
        const d: ConsolidationDecision = parseConsolidationDecision(
            JSON.stringify({ decision: "consolidate", confidence: 0.5, symbols: ["ok", 1, null, "two"] }),
        );
        expect(d.symbols).toEqual(["ok", "two"]);
    });

    test("drain processes all three branches and emits completion event", async () => {
        const userId = "u1";
        const episodes: Record<string, EpisodeRecord> = {
            e1: makeEpisode("e1", userId),
            e2: makeEpisode("e2", userId, { concepts: ["redis"] }),
            e3: makeEpisode("e3", userId),
        };
        const drops: string[] = [];
        const touches: string[][] = [];
        const memNodeUpserts: unknown[] = [];
        const epUpserts: unknown[] = [];
        const relateCalls: Array<[string, string]> = [];
        const fakeRedis = {
            listConsolidationCandidates: async () => ["e1", "e2", "e3"],
            readEpisode: async (_uid: string, id: string) => episodes[id],
            dropEpisode: async (_uid: string, id: string) => {
                drops.push(id);
            },
            touchConcepts: async (_uid: string, c: string[]) => {
                touches.push(c);
            },
        } as unknown as RedisMemoryStore;
        const fakeGraph = {
            upsertEpisode: async (i: unknown) => {
                epUpserts.push(i);
            },
            upsertMemoryNode: async (i: unknown) => {
                memNodeUpserts.push(i);
            },
            relateConsolidatedInto: async (a: string, b: string) => {
                relateCalls.push([a, b]);
            },
        } as unknown as SurrealGraphStore;
        const model = new StubModel([
            JSON.stringify({ decision: "consolidate", confidence: 0.9, summary: "s", symbols: ["x"] }),
            JSON.stringify({ decision: "reinforce", confidence: 0.6 }),
            JSON.stringify({ decision: "discard", confidence: 0.7 }),
        ]);
        const events = new CapturingSink();
        const worker = new ConsolidationWorker(fakeRedis, fakeGraph, model, events);
        const result = await worker.drain(userId);
        expect(result.scanned).toBe(3);
        expect(result.consolidated).toBe(1);
        expect(result.reinforced).toBe(1);
        expect(result.discarded).toBe(1);
        expect(result.skipped).toBe(0);
        expect(epUpserts.length).toBe(1);
        expect(memNodeUpserts.length).toBe(1);
        expect(relateCalls.length).toBe(1);
        expect(drops).toContain("e1");
        expect(drops).toContain("e3");
        expect(touches[0]).toEqual(["redis"]);
        expect(events.events.some((e) => e.type === RuntimeEventType.MemoryConsolidationCompleted)).toBe(true);
    });

    test("skipped when episode is missing from redis", async () => {
        const fakeRedis = {
            listConsolidationCandidates: async () => ["ghost"],
            readEpisode: async () => undefined,
            dropEpisode: async () => {},
            touchConcepts: async () => {},
        } as unknown as RedisMemoryStore;
        const fakeGraph = {} as SurrealGraphStore;
        const model = new StubModel(["{}"]);
        const events = new CapturingSink();
        const worker = new ConsolidationWorker(fakeRedis, fakeGraph, model, events);
        const result = await worker.drain("u1");
        expect(result.scanned).toBe(1);
        expect(result.skipped).toBe(1);
    });

    test("publishes failure event when listing candidates throws", async () => {
        const fakeRedis = {
            listConsolidationCandidates: async () => {
                throw new Error("conn refused");
            },
        } as unknown as RedisMemoryStore;
        const fakeGraph = {} as SurrealGraphStore;
        const events = new CapturingSink();
        const worker = new ConsolidationWorker(fakeRedis, fakeGraph, new StubModel(["{}"]), events);
        const result = await worker.drain("u1");
        expect(result.scanned).toBe(0);
        expect(events.events.some((e) => e.type === RuntimeEventType.MemoryConsolidationFailed)).toBe(true);
    });

    test("publishes failure event when per-candidate processing throws", async () => {
        const fakeRedis = {
            listConsolidationCandidates: async () => ["e1"],
            readEpisode: async () => {
                throw new Error("redis oom");
            },
            dropEpisode: async () => {},
            touchConcepts: async () => {},
        } as unknown as RedisMemoryStore;
        const fakeGraph = {} as SurrealGraphStore;
        const events = new CapturingSink();
        const worker = new ConsolidationWorker(fakeRedis, fakeGraph, new StubModel(["{}"]), events);
        const result = await worker.drain("u1");
        expect(result.skipped).toBe(1);
        expect(events.events.some((e) => e.type === RuntimeEventType.MemoryConsolidationFailed)).toBe(true);
    });
});

function makeEpisode(id: string, userId: string, over: Partial<EpisodeRecord> = {}): EpisodeRecord {
    return {
        episodeId: id,
        userId,
        text: `text for ${id}`,
        concepts: [],
        embedding: [0.1, 0.2, 0.3, 0.4],
        importance: 0.5,
        stability: 0.5,
        sourceKind: "session-turn",
        createdAt: 1_700_000_000_000,
        metadata: {},
        ...over,
    };
}

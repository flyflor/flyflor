/**
 * Dream worker 单元测试（README.md §12）。
 *
 * 用 fake SurrealGraphStore 覆盖三类动作的执行路径：
 *  - drift-repair 必须先 writeGemSnapshot 再 applyGemDriftRepair；
 *  - recall-reinforce 调 applyMemoryReinforce；
 *  - contradiction-audit 调 applyContradictionAudit 一或两次（取决于 weaker）。
 *
 * 同时验证：
 *  - parseDreamDecisions 对 enum/JSON shape 校验严格；
 *  - 未知 action 与缺失字段一律丢弃，不做关键词回退；
 *  - LLM 失败时所有候选计入 skipped；
 *  - 候选与决策的 kind 必须匹配，否则 skip（不会越界写入）。
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import {
    DreamActionKind,
    DreamWorkerImpl,
    NullDreamWorker,
    parseDreamDecisions,
} from "../src/agent/runtime/dream.worker.ts";
import type { SurrealGraphStore, GemRecord, MemoryNodeRecord } from "../src/neural/memory/surreal.graph.ts";
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

class ThrowingModel implements ModelClient {
    async generate(_messages: ModelMessage[]): Promise<string> {
        throw new Error("llm boom");
    }
}

interface FakeSurrealOpts {
    driftGems?: GemRecord[];
    recallTops?: MemoryNodeRecord[];
    recallBottoms?: MemoryNodeRecord[];
    pairs?: Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>;
}

class FakeSurrealGraph {
    readonly snapshots: Array<{ skillId: string; reason: string; takenAt: number }> = [];
    readonly drift: Array<Record<string, unknown>> = [];
    readonly reinforce: Array<Record<string, unknown>> = [];
    readonly contradiction: Array<Record<string, unknown>> = [];

    constructor(private readonly state: FakeSurrealOpts = {}) {}

    async listGemDriftCandidates(): Promise<GemRecord[]> {
        return this.state.driftGems ?? [];
    }
    async listRecallExtremes(): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }> {
        return { tops: this.state.recallTops ?? [], bottoms: this.state.recallBottoms ?? [] };
    }
    async listContradictionPairs(): Promise<
        Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>
    > {
        return this.state.pairs ?? [];
    }
    async writeGemSnapshot(skill: GemRecord, reason: string, takenAtMs: number): Promise<string> {
        const id = `${skill.id}-${takenAtMs}`;
        this.snapshots.push({ skillId: skill.id, reason, takenAt: takenAtMs });
        return id;
    }
    async applyGemDriftRepair(input: Record<string, unknown>): Promise<boolean> {
        this.drift.push(input);
        return true;
    }
    async applyMemoryReinforce(input: Record<string, unknown>): Promise<boolean> {
        this.reinforce.push(input);
        return true;
    }
    async applyContradictionAudit(input: Record<string, unknown>): Promise<boolean> {
        this.contradiction.push(input);
        return true;
    }
}

function fakeAs(graph: FakeSurrealGraph): SurrealGraphStore {
    return graph as unknown as SurrealGraphStore;
}

function mkSkill(over: Partial<GemRecord> = {}): GemRecord {
    return {
        id: "s1",
        userId: "u1",
        symbols: ["x"],
        summary: "old summary",
        embedding: [],
        confidence: 0.4,
        support: 1,
        protected: false,
        updatedAt: 0,
        recallCount: 0,
        contradictionCount: 0,
        ...over,
    };
}

function mkMem(over: Partial<MemoryNodeRecord> = {}): MemoryNodeRecord {
    return {
        id: "m1",
        userId: "u1",
        symbols: ["y"],
        summary: "mem one",
        embedding: [],
        confidence: 0.6,
        evidenceCount: 2,
        importance: 0.5,
        updatedAt: 0,
        recallCount: 0,
        ...over,
    };
}

describe("parseDreamDecisions", () => {
    test("rejects non-object / missing decisions array", () => {
        expect(parseDreamDecisions("not json")).toEqual([]);
        expect(parseDreamDecisions(JSON.stringify({}))).toEqual([]);
        expect(parseDreamDecisions(JSON.stringify({ decisions: "x" }))).toEqual([]);
    });

    test("drops entries with missing candidateId or unknown action", () => {
        const raw = JSON.stringify({
            decisions: [
                { action: "skip" },
                { candidateId: "", action: "skip" },
                { candidateId: "c1", action: "nonsense" },
                { candidateId: "c2", action: "skip" },
            ],
        });
        const out = parseDreamDecisions(raw);
        expect(out).toEqual([{ candidateId: "c2", action: DreamActionKind.Skip }]);
    });

    test("drift-repair clamps and sanitizes fields", () => {
        const raw = JSON.stringify({
            decisions: [
                {
                    candidateId: "drift:s1",
                    action: "drift-repair",
                    newSummary: "Tighter scope",
                    newSymbols: ["A", "a", " b ", 42, "c", "c"],
                    scopeNote: "only macOS",
                    newStatus: "deprecated",
                    confidenceMultiplier: 5,
                },
            ],
        });
        const out = parseDreamDecisions(raw);
        expect(out).toHaveLength(1);
        const d = out[0]!;
        if (d.action !== DreamActionKind.DriftRepair) throw new Error("expected drift-repair");
        expect(d.newSummary).toBe("Tighter scope");
        expect(d.newSymbols).toEqual(["a", "b", "c"]);
        expect(d.scopeNote).toBe("only macOS");
        expect(d.newStatus).toBe("deprecated");
        expect(d.confidenceMultiplier).toBe(1);
    });

    test("recall-reinforce clamps importanceMultiplier into [0.5,1.5]", () => {
        const raw = JSON.stringify({
            decisions: [
                { candidateId: "r1", action: "recall-reinforce", importanceMultiplier: 99 },
                { candidateId: "r2", action: "recall-reinforce", importanceMultiplier: -1 },
                { candidateId: "r3", action: "recall-reinforce" },
            ],
        });
        const out = parseDreamDecisions(raw);
        expect(out.map((d) => (d.action === DreamActionKind.RecallReinforce ? d.importanceMultiplier : null))).toEqual([
            1.5, 0.5, 1.0,
        ]);
    });

    test("contradiction-audit requires weaker enum; drops invalid", () => {
        const raw = JSON.stringify({
            decisions: [
                { candidateId: "p1", action: "contradiction-audit", weaker: "unknown" },
                {
                    candidateId: "p2",
                    action: "contradiction-audit",
                    weaker: "left",
                    confidenceMultiplier: 0.1,
                    contradictionDelta: 99,
                },
            ],
        });
        const out = parseDreamDecisions(raw);
        expect(out).toHaveLength(1);
        const d = out[0]!;
        if (d.action !== DreamActionKind.ContradictionAudit) throw new Error("expected contradiction-audit");
        expect(d.weaker).toBe("left");
        expect(d.confidenceMultiplier).toBe(0.3);
        expect(d.contradictionDelta).toBe(5);
    });
});

describe("NullDreamWorker", () => {
    test("runOnce returns zeroed result", async () => {
        const w = new NullDreamWorker();
        const r = await w.runOnce("u1");
        expect(r).toEqual({
            scanned: 0,
            driftRepaired: 0,
            recallReinforced: 0,
            contradictionsFlagged: 0,
            skipped: 0,
        });
    });
});

describe("DreamWorkerImpl.runOnce", () => {
    const now = () => 1_700_000_000_000;

    test("empty userId returns zero without calling LLM", async () => {
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(new FakeSurrealGraph()), new StubModel([]), sink, { now });
        const r = await w.runOnce("");
        expect(r.scanned).toBe(0);
        expect(sink.events).toHaveLength(0);
    });

    test("no candidates → publishes completed with zero", async () => {
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(new FakeSurrealGraph()), new StubModel([]), sink, { now });
        const r = await w.runOnce("u1");
        expect(r.scanned).toBe(0);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryDreamCompleted);
    });

    test("drift-repair: snapshots before repair and fires MemoryDriftRepaired", async () => {
        const graph = new FakeSurrealGraph({ driftGems: [mkSkill({ id: "s1" })] });
        const model = new StubModel([
            JSON.stringify({
                decisions: [
                    {
                        candidateId: "drift:s1",
                        action: "drift-repair",
                        newSummary: "tighter",
                        newSymbols: ["a"],
                        newStatus: "active",
                        confidenceMultiplier: 0.5,
                    },
                ],
            }),
        ]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(graph), model, sink, { now });
        const r = await w.runOnce("u1");
        expect(r.driftRepaired).toBe(1);
        expect(r.skipped).toBe(0);
        expect(graph.snapshots).toHaveLength(1);
        expect(graph.snapshots[0]!.skillId).toBe("s1");
        expect(graph.drift).toHaveLength(1);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryDriftRepaired);
    });

    test("recall-reinforce: applies importance multiplier to target", async () => {
        const graph = new FakeSurrealGraph({ recallTops: [mkMem({ id: "m1" })] });
        const model = new StubModel([
            JSON.stringify({
                decisions: [
                    { candidateId: "recall-top:memory_node:m1", action: "recall-reinforce", importanceMultiplier: 1.2 },
                ],
            }),
        ]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(graph), model, sink, { now });
        const r = await w.runOnce("u1");
        expect(r.recallReinforced).toBe(1);
        expect(graph.reinforce[0]).toMatchObject({ table: "memory_node", id: "m1", importanceMultiplier: 1.2 });
    });

    test("contradiction-audit (both): applies to both sides", async () => {
        const graph = new FakeSurrealGraph({
            pairs: [{ left: mkMem({ id: "L" }), right: mkMem({ id: "R" }), cosine: 0.9 }],
        });
        const model = new StubModel([
            JSON.stringify({
                decisions: [{ candidateId: "contra:L:R", action: "contradiction-audit", weaker: "both" }],
            }),
        ]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(graph), model, sink, { now });
        const r = await w.runOnce("u1");
        expect(r.contradictionsFlagged).toBe(1);
        expect(graph.contradiction).toHaveLength(2);
    });

    test("kind mismatch (drift-repair on a recall candidate) → skip, no writes", async () => {
        const graph = new FakeSurrealGraph({ recallTops: [mkMem({ id: "m1" })] });
        const model = new StubModel([
            JSON.stringify({
                decisions: [{ candidateId: "recall-top:memory_node:m1", action: "drift-repair", newSummary: "no" }],
            }),
        ]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(graph), model, sink, { now });
        const r = await w.runOnce("u1");
        expect(r.skipped).toBe(1);
        expect(graph.snapshots).toHaveLength(0);
        expect(graph.drift).toHaveLength(0);
    });

    test("LLM throws → all candidates skipped, MemoryDreamFailed emitted", async () => {
        const graph = new FakeSurrealGraph({ recallTops: [mkMem({ id: "m1" })] });
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(fakeAs(graph), new ThrowingModel(), sink, { now });
        const r = await w.runOnce("u1");
        expect(r.scanned).toBe(1);
        expect(r.skipped).toBe(1);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryDreamFailed);
    });
});

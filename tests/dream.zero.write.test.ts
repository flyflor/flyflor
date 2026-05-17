import { describe, expect, test } from "bun:test";
import { DreamWorkerImpl } from "../src/neural/memory/dream.worker.ts";
import type { GemRecord, MemoryNodeRecord, MemoryGraphStore } from "../src/neural/memory/graph/types.ts";
import { ModelRole, type ModelClient } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

/**
 * LF-R6 hard rule: "no signal source → zero writes".
 * dream pass with no candidates from collectDreamCandidates must:
 *  - not call the LLM,
 *  - not invoke any graph write method,
 *  - emit MemoryDreamCompleted with all-zero result.
 */

class ZeroSignalGraph {
    public callLog: string[] = [];
    public async listGemDriftCandidates(): Promise<GemRecord[]> {
        this.callLog.push("listGemDriftCandidates");
        return [];
    }
    public async listRecallExtremes(): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }> {
        this.callLog.push("listRecallExtremes");
        return { tops: [], bottoms: [] };
    }
    public async listContradictionPairs(): Promise<Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>> {
        this.callLog.push("listContradictionPairs");
        return [];
    }
    public async writeGemSnapshot(): Promise<string> {
        this.callLog.push("writeGemSnapshot");
        return "should-not-be-called";
    }
    public async applyGemDriftRepair(): Promise<boolean> {
        this.callLog.push("applyGemDriftRepair");
        return true;
    }
    public async applyMemoryReinforce(): Promise<boolean> {
        this.callLog.push("applyMemoryReinforce");
        return true;
    }
    public async applyContradictionAudit(): Promise<boolean> {
        this.callLog.push("applyContradictionAudit");
        return true;
    }
    public async applyReconsolidation(): Promise<boolean> {
        this.callLog.push("applyReconsolidation");
        return true;
    }
}

class CountingModel implements ModelClient {
    public calls = 0;
    public async generate(): Promise<string> {
        this.calls += 1;
        return JSON.stringify({ decisions: [] });
    }
    public readonly role = ModelRole.Assistant;
}

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    public publish(event: { type: string; payload?: Record<string, unknown> }): void {
        this.events.push(event);
    }
}

describe("LF-R6: dream zero-write hard rule", () => {
    test("no candidates → no LLM call, no graph writes, zero result, MemoryDreamCompleted", async () => {
        const graph = new ZeroSignalGraph();
        const model = new CountingModel();
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(graph as unknown as MemoryGraphStore, model, sink);
        const r = await w.runOnce("u1");
        expect(r.scanned).toBe(0);
        expect(r.driftRepaired).toBe(0);
        expect(r.recallReinforced).toBe(0);
        expect(r.contradictionsFlagged).toBe(0);
        expect(r.reconsolidated).toBe(0);
        expect(r.skipped).toBe(0);
        expect(model.calls).toBe(0);
        const writeCalls = graph.callLog.filter((c) =>
            ["writeGemSnapshot", "applyGemDriftRepair", "applyMemoryReinforce", "applyContradictionAudit", "applyReconsolidation"].includes(c),
        );
        expect(writeCalls).toEqual([]);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryDreamCompleted);
    });

    test("collect throws → no LLM call, no graph writes, MemoryDreamFailed emitted", async () => {
        const graph = new (class extends ZeroSignalGraph {
            public override async listGemDriftCandidates(): Promise<GemRecord[]> {
                this.callLog.push("listGemDriftCandidates");
                throw new Error("graph down");
            }
        })();
        const model = new CountingModel();
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(graph as unknown as MemoryGraphStore, model, sink);
        const r = await w.runOnce("u1");
        expect(r.scanned).toBe(0);
        expect(model.calls).toBe(0);
        const writeCalls = graph.callLog.filter((c) =>
            ["applyGemDriftRepair", "applyMemoryReinforce", "applyContradictionAudit", "applyReconsolidation"].includes(c),
        );
        expect(writeCalls).toEqual([]);
        expect(sink.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryDreamFailed);
    });

    test("empty userId → no graph methods invoked", async () => {
        const graph = new ZeroSignalGraph();
        const model = new CountingModel();
        const w = new DreamWorkerImpl(graph as unknown as MemoryGraphStore, model, new CapturingSink());
        const r = await w.runOnce("");
        expect(r.scanned).toBe(0);
        expect(model.calls).toBe(0);
        expect(graph.callLog).toEqual([]);
    });
});

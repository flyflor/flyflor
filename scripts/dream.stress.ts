#!/usr/bin/env bun
/**
 * Dream worker 压测脚本（M-04）。
 *
 * 目标：在真实 LLM / 外部图数据库 不可用的开发环境中，验证 DreamWorkerImpl
 * 在大批量候选下的吞吐与稳定性。完全基于内存驱动，不接外部图数据库、不接外网。
 *
 * 用法：
 *   bun run scripts/dream.stress.ts [--candidates N] [--passes P] [--mix drift,recall,contradiction]
 *
 * 输出：
 *   每个 pass 的耗时、apply 分类计数、avg 候选/秒，最后给出 P50 / P95 / max 总览。
 */

import { join } from "node:path";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import {
    DreamActionKind,
    DreamWorkerImpl,
    type DreamRunResult,
} from "../src/neural/memory/dream/index.ts";
import { DreamCandidateKind } from "../src/neural/memory/dream/index.ts";
import type { MemoryGraphStore, GemRecord, MemoryNodeRecord } from "../src/neural/memory/graph/index.ts";
import type { ModelClient, ModelMessage } from "../src/protocol/contracts/index.ts";
import type { EventSink } from "../src/protocol/events/index.ts";

interface CliOpts {
    candidates: number;
    passes: number;
    mix: { drift: number; recall: number; contradiction: number };
}

function parseArgs(argv: string[]): CliOpts {
    const opts: CliOpts = { candidates: 200, passes: 10, mix: { drift: 1, recall: 1, contradiction: 1 } };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === "--candidates" && argv[i + 1]) {
            opts.candidates = Math.max(1, Number.parseInt(argv[i + 1]!, 10) || opts.candidates);
            i += 1;
        } else if (a === "--passes" && argv[i + 1]) {
            opts.passes = Math.max(1, Number.parseInt(argv[i + 1]!, 10) || opts.passes);
            i += 1;
        } else if (a === "--mix" && argv[i + 1]) {
            const parts = argv[i + 1]!.split(",").map((s) => Number.parseInt(s.trim(), 10));
            if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
                opts.mix = { drift: parts[0]!, recall: parts[1]!, contradiction: parts[2]! };
            }
            i += 1;
        }
    }
    return opts;
}

function buildState(opts: CliOpts): {
    drift: GemRecord[];
    tops: MemoryNodeRecord[];
    pairs: Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>;
} {
    const total = opts.candidates;
    const totalWeight = opts.mix.drift + opts.mix.recall + opts.mix.contradiction || 1;
    const driftN = Math.floor((total * opts.mix.drift) / totalWeight);
    const recallN = Math.floor((total * opts.mix.recall) / totalWeight);
    const contradictionN = Math.max(0, total - driftN - recallN);

    const drift: GemRecord[] = Array.from({ length: driftN }, (_, i) => ({
        id: `s${i}`,
        userId: "u1",
        symbols: [`sym${i % 7}`],
        summary: `skill ${i}`,
        embedding: [],
        confidence: 0.3,
        support: 1,
        protected: false,
        updatedAt: 0,
        recallCount: 0,
        contradictionCount: 3,
    }));

    const tops: MemoryNodeRecord[] = Array.from({ length: recallN }, (_, i) => ({
        id: `m${i}`,
        userId: "u1",
        symbols: [`tag${i % 5}`],
        summary: `memory ${i}`,
        embedding: [],
        confidence: 0.6,
        evidenceCount: 2,
        importance: 0.5,
        updatedAt: 0,
        recallCount: 10,
    }));

    const pairs = Array.from({ length: contradictionN }, (_, i) => ({
        left: { ...tops[0]!, id: `pl${i}` },
        right: { ...tops[0]!, id: `pr${i}` },
        cosine: 0.85,
    }));

    return { drift, tops, pairs };
}

class StressGraph {
    public snapshots = 0;
    public drift = 0;
    public reinforce = 0;
    public contradiction = 0;

    public constructor(
        private readonly drifts: GemRecord[],
        private readonly tops: MemoryNodeRecord[],
        private readonly pairs: Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }>,
    ) {}

    public async listGemDriftCandidates(): Promise<GemRecord[]> {
        return this.drifts;
    }
    public async listRecallExtremes(): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }> {
        return { tops: this.tops, bottoms: [] };
    }
    public async listContradictionPairs(): Promise<typeof this.pairs> {
        return this.pairs;
    }
    public async writeGemSnapshot(_skill: GemRecord, _reason: string, takenAtMs: number): Promise<string> {
        this.snapshots += 1;
        return `snap-${takenAtMs}-${this.snapshots}`;
    }
    public async applyGemDriftRepair(_input: Record<string, unknown>): Promise<boolean> {
        this.drift += 1;
        return true;
    }
    public async applyMemoryReinforce(_input: Record<string, unknown>): Promise<boolean> {
        this.reinforce += 1;
        return true;
    }
    public async applyContradictionAudit(_input: Record<string, unknown>): Promise<boolean> {
        this.contradiction += 1;
        return true;
    }
}

class DeterministicModel implements ModelClient {
    public async generate(messages: ModelMessage[]): Promise<string> {
        const text = messages[messages.length - 1]?.content ?? "";
        const ids = Array.from(text.matchAll(/candidateId:\s*([^\s]+)/g)).map((m) => m[1]!);
        const decisions = ids.map((id) => {
            if (id.startsWith("drift:")) {
                return {
                    candidateId: id,
                    action: DreamActionKind.DriftRepair,
                    newSummary: "tighter",
                    newSymbols: ["a", "b"],
                    confidenceMultiplier: 0.8,
                };
            }
            if (id.startsWith("recall-")) {
                return {
                    candidateId: id,
                    action: DreamActionKind.RecallReinforce,
                    importanceMultiplier: 1.2,
                };
            }
            if (id.startsWith("contra:")) {
                return {
                    candidateId: id,
                    action: DreamActionKind.ContradictionAudit,
                    weaker: "left",
                    confidenceMultiplier: 0.7,
                    contradictionDelta: 1,
                };
            }
            return { candidateId: id, action: DreamActionKind.Skip };
        });
        return JSON.stringify({ decisions });
    }
}

class NullSink implements EventSink {
    public publish(_evt: { type: string; payload?: Record<string, unknown> }): void {
        // 压测期间不输出事件，避免 IO 干扰耗时测量。
    }
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx]!;
}

async function main(): Promise<void> {
    const opts = parseArgs(Bun.argv.slice(2));
    await loadPromptTemplates({
        promptDir: join(import.meta.dir, "..", "templates", "prompts"),
    } as never);

    const state = buildState(opts);
    const graph = new StressGraph(state.drift, state.tops, state.pairs);
    const model = new DeterministicModel();
    const worker = new DreamWorkerImpl(graph as unknown as MemoryGraphStore, model, new NullSink(), {
        maxCandidates: opts.candidates,
    });

    console.log(
        `[dream-stress] candidates=${opts.candidates} passes=${opts.passes} mix=${JSON.stringify(opts.mix)}`,
    );

    const passDurations: number[] = [];
    const totals: DreamRunResult = {
        scanned: 0,
        driftRepaired: 0,
        recallReinforced: 0,
        contradictionsFlagged: 0,
        reconsolidated: 0,
        skipped: 0,
    };

    for (let i = 0; i < opts.passes; i += 1) {
        const start = performance.now();
        const result = await worker.runOnce("u1", opts.candidates);
        const elapsed = performance.now() - start;
        passDurations.push(elapsed);
        totals.scanned += result.scanned;
        totals.driftRepaired += result.driftRepaired;
        totals.recallReinforced += result.recallReinforced;
        totals.contradictionsFlagged += result.contradictionsFlagged;
        totals.reconsolidated += result.reconsolidated;
        totals.skipped += result.skipped;
        const tps = result.scanned > 0 ? Math.round((result.scanned / elapsed) * 1000) : 0;
        console.log(
            `[pass ${i + 1}/${opts.passes}] scanned=${result.scanned} ` +
                `drift=${result.driftRepaired} recall=${result.recallReinforced} ` +
                `contra=${result.contradictionsFlagged} skipped=${result.skipped} ` +
                `elapsed=${elapsed.toFixed(1)}ms throughput=${tps}/s`,
        );
    }

    console.log("\n[summary]");
    console.log(`  total scanned       : ${totals.scanned}`);
    console.log(`  drift repaired      : ${totals.driftRepaired}`);
    console.log(`  recall reinforced   : ${totals.recallReinforced}`);
    console.log(`  contradictions      : ${totals.contradictionsFlagged}`);
    console.log(`  reconsolidated      : ${totals.reconsolidated}`);
    console.log(`  skipped             : ${totals.skipped}`);
    console.log(`  graph.snapshots     : ${graph.snapshots}`);
    console.log(`  pass duration p50   : ${percentile(passDurations, 50).toFixed(1)}ms`);
    console.log(`  pass duration p95   : ${percentile(passDurations, 95).toFixed(1)}ms`);
    console.log(`  pass duration max   : ${Math.max(...passDurations).toFixed(1)}ms`);
    const avgTps = totals.scanned > 0
        ? Math.round((totals.scanned / passDurations.reduce((a, b) => a + b, 0)) * 1000)
        : 0;
    console.log(`  avg throughput      : ${avgTps}/s`);
}

main().catch((err) => {
    console.error("[dream-stress] failed:", err);
    process.exit(1);
});

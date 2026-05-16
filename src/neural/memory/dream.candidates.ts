/**
 * Dream 模式候选采集（README.md §12）。
 *
 * 三类候选来自晶体图 Component 的资源指标（counter / age / cosine / recallCount），
 * 不读 text、不做关键词匹配；语义判定全部由 LLM 在结构化 prompt 中产出。
 *
 * - drift candidate: skill 上的稳定度信号（contradictionCount / lastVerifiedAt / confidence）触发
 *   修复审计；
 * - recall candidate: memory_node / skill 在近 N 天 recallCount 的两极（top + bottom）；
 * - contradiction candidate: 高 importance memory_node 的 ANN 邻居二元对（cosine 高但是 importance
 *   差距大，疑似冲突），交给 LLM 决断是否矛盾。
 *
 * 阈值常量在 README.md §12.2 单点定义；后续若需 expose 给 config 在此聚合即可。
 */

import type { MemoryNodeRecord, GemRecord, MemoryGraphStore } from "../../components/memory/graph.store.ts";

export const DREAM_THRESHOLDS = {
    /** drift: skill 上 contradictionCount 达到此值即列入修复审计候选。 */
    minContradictionCount: 2,
    /** drift: lastVerifiedAt 距今超过此值即列入候选（毫秒）。 */
    maxStaleMs: 30 * 24 * 60 * 60 * 1000,
    /** drift: confidence 低于此值即列入候选。 */
    maxConfidence: 0.5,
    /** recall reinforce: top N 召回热门。 */
    topRecallN: 6,
    /** recall reinforce: bottom N 召回冷门（潜在归档）。 */
    bottomRecallN: 6,
    /** contradiction: 取 importance 最高的 N 个 memory_node 做邻居采样。 */
    contradictionSeedN: 8,
    /** contradiction: ANN 邻居每个 seed 最多取 K 个。 */
    contradictionNeighborK: 4,
    /** contradiction: 仅当 cosine 相似度 ≥ 该阈值的邻居才算"疑似冲突"。 */
    contradictionMinCosine: 0.78,
    /** dream 单 pass 送 LLM 的候选总上限（drift+recall+contradiction）。 */
    maxCandidatesPerPass: 24,
} as const;

export const DreamCandidateKind = {
    SkillDrift: "skill-drift",
    Recall: "recall",
    ContradictionPair: "contradiction-pair",
} as const;
export type DreamCandidateKind = (typeof DreamCandidateKind)[keyof typeof DreamCandidateKind];

/** 公共候选信号字段（不读 text，只暴露资源指标 + 摘要）。 */
export interface DreamSignals {
    confidence?: number;
    contradictionCount?: number;
    recallCount?: number;
    importance?: number;
    /** lastVerifiedAt 距今的毫秒数；用于 LLM 直观判断 staleness。 */
    staleMs?: number;
}

export interface DreamGemDriftCandidate {
    candidateId: string;
    kind: typeof DreamCandidateKind.SkillDrift;
    gemId: string;
    summary: string;
    symbols: string[];
    signals: DreamSignals;
}

export interface DreamRecallCandidate {
    candidateId: string;
    kind: typeof DreamCandidateKind.Recall;
    target: { table: "memory_node" | "gem"; id: string };
    summary: string;
    symbols: string[];
    /** "top" = 高于近期均值的热门；"bottom" = 长期不被召回的冷门。 */
    bucket: "top" | "bottom";
    signals: DreamSignals;
}

export interface DreamContradictionPairCandidate {
    candidateId: string;
    kind: typeof DreamCandidateKind.ContradictionPair;
    left: { table: "memory_node" | "gem"; id: string; summary: string };
    right: { table: "memory_node" | "gem"; id: string; summary: string };
    /** 邻居之间的余弦相似度（保留两位小数，供 LLM 参考）。 */
    cosine: number;
    signalsLeft: DreamSignals;
    signalsRight: DreamSignals;
}

export type DreamCandidate = DreamGemDriftCandidate | DreamRecallCandidate | DreamContradictionPairCandidate;

export interface CollectDreamCandidatesInput {
    userId: string;
    nowMs: number;
}

/**
 * 单次 dream pass 的候选集合（已按上限截断）。
 * 收集器只发查询；写入由 dream module 在 LLM 决策后回写。
 */
export async function collectDreamCandidates(
    graph: MemoryGraphStore,
    input: CollectDreamCandidatesInput,
): Promise<DreamCandidate[]> {
    const { userId, nowMs } = input;
    const out: DreamCandidate[] = [];

    const driftGems = await graph.listGemDriftCandidates({
        userId,
        nowMs,
        minContradictionCount: DREAM_THRESHOLDS.minContradictionCount,
        maxStaleMs: DREAM_THRESHOLDS.maxStaleMs,
        maxConfidence: DREAM_THRESHOLDS.maxConfidence,
        limit: 8,
    });
    for (const s of driftGems) {
        out.push({
            candidateId: `drift:${s.id}`,
            kind: DreamCandidateKind.SkillDrift,
            gemId: s.id,
            summary: s.summary,
            symbols: s.symbols ?? [],
            signals: extractSignals(s, nowMs),
        });
    }

    const recall = await graph.listRecallExtremes({
        userId,
        topN: DREAM_THRESHOLDS.topRecallN,
        bottomN: DREAM_THRESHOLDS.bottomRecallN,
    });
    for (const node of recall.tops) {
        out.push({
            candidateId: `recall-top:memory_node:${node.id}`,
            kind: DreamCandidateKind.Recall,
            target: { table: "memory_node", id: node.id },
            summary: node.summary,
            symbols: node.symbols ?? [],
            bucket: "top",
            signals: extractSignals(node, nowMs),
        });
    }
    for (const node of recall.bottoms) {
        out.push({
            candidateId: `recall-bot:memory_node:${node.id}`,
            kind: DreamCandidateKind.Recall,
            target: { table: "memory_node", id: node.id },
            summary: node.summary,
            symbols: node.symbols ?? [],
            bucket: "bottom",
            signals: extractSignals(node, nowMs),
        });
    }

    const pairs = await graph.listContradictionPairs({
        userId,
        seedN: DREAM_THRESHOLDS.contradictionSeedN,
        neighborK: DREAM_THRESHOLDS.contradictionNeighborK,
        minCosine: DREAM_THRESHOLDS.contradictionMinCosine,
    });
    for (const p of pairs) {
        out.push({
            candidateId: `contra:${p.left.id}:${p.right.id}`,
            kind: DreamCandidateKind.ContradictionPair,
            left: { table: "memory_node", id: p.left.id, summary: p.left.summary },
            right: { table: "memory_node", id: p.right.id, summary: p.right.summary },
            cosine: Math.round(p.cosine * 100) / 100,
            signalsLeft: extractSignals(p.left, nowMs),
            signalsRight: extractSignals(p.right, nowMs),
        });
    }

    return out.slice(0, DREAM_THRESHOLDS.maxCandidatesPerPass);
}

function extractSignals(
    row: {
        confidence?: number;
        importance?: number;
        recallCount?: number;
        contradictionCount?: number;
        lastVerifiedAt?: number;
    },
    nowMs: number,
): DreamSignals {
    const sig: DreamSignals = {};
    if (typeof row.confidence === "number") sig.confidence = row.confidence;
    if (typeof row.importance === "number") sig.importance = row.importance;
    if (typeof row.recallCount === "number") sig.recallCount = row.recallCount;
    if (typeof row.contradictionCount === "number") sig.contradictionCount = row.contradictionCount;
    if (typeof row.lastVerifiedAt === "number") sig.staleMs = Math.max(0, nowMs - row.lastVerifiedAt);
    return sig;
}

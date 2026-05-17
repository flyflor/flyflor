/**
 * 概念激活展开 (spreading activation) — 纯函数版。
 *
 * 输入：当前 query embedding + 热点概念列表 + episode 候选（带 embedding/concepts/importance）。
 * 输出：按激活分数排序后的 episode 子集。
 *
 * 设计约束（与 docs/boundaries.md 对齐）：
 * - **零字符串匹配**：query 与 episode 之间不做 text.includes 或正则；
 *   仅依赖向量余弦 + 概念集合交集 + importance/recency 这些资源指标。
 * - 无 I/O，无 clock 依赖（now 由调用方注入），方便测试与编译进二进制。
 * - 复杂度 O(N·D)，N=候选数，D=embedding 维度；调用方应先按 hotConcepts 缩 N。
 */

export interface ActivationCandidate {
    id: string;
    embedding?: number[];
    concepts?: string[];
    importance: number;
    /** 创建时间戳 (ms) — 用于 recency 衰减 */
    createdAt: number;
}

export interface ActivationInput {
    queryEmbedding?: number[];
    hotConcepts: string[];
    candidates: ActivationCandidate[];
    nowMs: number;
    /** 召回上限 */
    topK: number;
    /** recency 衰减半衰期（小时），默认 24h */
    halfLifeHours?: number;
    /** 三因子权重，默认 similarity 0.55 / concept 0.25 / importance·recency 0.20 */
    weights?: { similarity?: number; concept?: number; importance?: number };
    /** 最低激活分数阈值，低于则丢弃，默认 0.05 */
    minScore?: number;
}

export interface ActivationResult {
    id: string;
    score: number;
    breakdown: { similarity: number; concept: number; importance: number; recency: number };
}

/**
 * Hippocampus spreading activation owner.
 *
 * Production memory paths should hold this engine. The exported function below
 * remains as a compatibility shim for existing tests and public imports.
 */
export class SpreadingActivationEngine {
    public spread(input: ActivationInput): ActivationResult[] {
        const halfLifeHours = input.halfLifeHours ?? 24;
        const w = {
            similarity: input.weights?.similarity ?? 0.55,
            concept: input.weights?.concept ?? 0.25,
            importance: input.weights?.importance ?? 0.2,
        };
        const minScore = input.minScore ?? 0.05;
        const hotSet = new Set(input.hotConcepts);
        const halfLifeMs = halfLifeHours * 3_600_000;

        const scored: ActivationResult[] = [];
        for (const c of input.candidates) {
            const similarity = input.queryEmbedding && c.embedding ? this.cosine(input.queryEmbedding, c.embedding) : 0;
            const conceptOverlap = this.conceptScore(c.concepts ?? [], hotSet);
            const importance = this.clamp01(c.importance);
            const ageMs = Math.max(0, input.nowMs - c.createdAt);
            const recency = halfLifeMs > 0 ? Math.pow(0.5, ageMs / halfLifeMs) : 1;
            const importanceWithRecency = importance * recency;
            const score =
                w.similarity * Math.max(0, similarity) +
                w.concept * conceptOverlap +
                w.importance * importanceWithRecency;
            if (score >= minScore) {
                scored.push({
                    id: c.id,
                    score,
                    breakdown: { similarity, concept: conceptOverlap, importance, recency },
                });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, Math.max(0, input.topK));
    }

    private conceptScore(concepts: string[], hotSet: Set<string>): number {
        if (concepts.length === 0 || hotSet.size === 0) return 0;
        let hit = 0;
        for (const c of concepts) {
            if (hotSet.has(c)) hit += 1;
        }
        // 用 (hits / sqrt(|hot|·|concepts|)) 做 cosine-style 归一化，避免长概念列表占便宜。
        return hit / Math.sqrt(hotSet.size * concepts.length);
    }

    private cosine(a: number[], b: number[]): number {
        if (!Array.isArray(a) || !Array.isArray(b)) return 0;
        if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < a.length; i += 1) {
            const av = Number.isFinite(a[i]) ? (a[i] as number) : 0;
            const bv = Number.isFinite(b[i]) ? (b[i] as number) : 0;
            dot += av * bv;
            magA += av * av;
            magB += bv * bv;
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    private clamp01(value: number): number {
        if (Number.isNaN(value)) return 0;
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }
}

export const spreadingActivationEngine = new SpreadingActivationEngine();

export function spreadActivation(input: ActivationInput): ActivationResult[] {
    return spreadingActivationEngine.spread(input);
}

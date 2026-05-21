/**
 * Scope 固化触发器。
 *
 * 三条触发路径（与 scope-centric context/ledger split 对齐）：
 *
 *   A 显式用户意图（最高优先级）
 *     由模型在 memory action 的 signals 中给出 scopeIntent / scopeEventIntent ∈ [0,1]，
 *     ≥ 0.7 即视为显式意图，立即固化（不等 cluster）。
 *
 *   B 概念 cluster 自动触发（被动识别）
 *     某 ownerKey 下若存在一组 episode：
 *       - cluster_size >= scopeInitThreshold（默认 5）
 *       - 跨越 ≥ 2 次不同 turn（用 createdAt 离散度近似）
 *       - 至少有 1 条 sourceKind = blackboard-converged 或 mcp-augmented
 *       - cluster evidence_score > 0.5
 *     → 触发 scope-candidate（由调用方通过 ask/decision form 询问用户确认）。
 *
 *   C 技能升格触发（自动，最保守）
 *     某 skill：support >= 5 AND confidence > 0.7
 *     → 标记 domain-anchor，在 MEMORY.md 追加技能摘要（不创建新文件）。
 *
 * 严格遵守 docs/boundaries.md "业务语义零字符匹配"——
 * 三条路径全部用资源指标（signals 数值 / cluster 大小 / cosine / support / confidence）判定，
 * 没有任何 text.includes / 正则 / 关键词。
 */

import type { MemoryAction } from "../memory/actions/index.ts";
import type { EpisodeRecord } from "../memory/working/types.ts";
import { MemorySourceKind } from "../../../protocol/contracts/index.ts";

export const ScopeTriggerKind = {
    ExplicitScope: "explicit-scope",
    ExplicitScopeEvent: "explicit-scope-event",
    ExplicitSkill: "explicit-skill",
    ClusterCandidate: "cluster-candidate",
    SkillCandidate: "skill-candidate",
    SkillPromotion: "skill-promotion",
    CodenamePromotion: "codename-promotion",
    None: "none",
} as const;
export type ScopeTriggerKind = (typeof ScopeTriggerKind)[keyof typeof ScopeTriggerKind];

export interface ScopeTriggerResult {
    kind: ScopeTriggerKind;
    score: number;
    relatedIds: string[];
    rationale: string;
}

export interface ScopeTriggerConfig {
    explicitThreshold?: number;
    scopeInitThreshold?: number;
    clusterEvidenceMin?: number;
    skillSupportMin?: number;
    skillConfidenceMin?: number;
    /** LF-R2 codename promotion: useCount threshold (default 5). */
    codenameUseCountMin?: number;
    /** LF-R2 codename promotion: minimum age in ms before auto-promotion (default 1h). */
    codenameMinAgeMs?: number;
}

const DEFAULTS: Required<ScopeTriggerConfig> = {
    explicitThreshold: 0.7,
    scopeInitThreshold: 5,
    clusterEvidenceMin: 0.5,
    skillSupportMin: 5,
    skillConfidenceMin: 0.7,
    codenameUseCountMin: 5,
    codenameMinAgeMs: 60 * 60 * 1000,
};

export interface ConceptCluster {
    concepts: string[];
    episodes: EpisodeRecord[];
}

export interface SkillPromotionCandidate {
    id: string;
    support: number;
    confidence: number;
    summary?: string;
}

export interface SkillClusterInput {
    /** 共享的 MCP 工具调用集合（按字典序去重）。 */
    tools: string[];
    /** 命中此工具组合的 episode。 */
    episodes: EpisodeRecord[];
}

export interface CodenamePromotionInput {
    id: string;
    name: string;
    useCount: number;
    createdAt: number;
    lastUsedAt: number;
    /** 已经升格过的 codename 不再触发，由调用方传入。 */
    scopeId?: string;
}

/**
 * Numeric scope/skill/codename trigger detector.
 *
 * The detector only consumes model-emitted numeric signals and resource
 * metrics. It must never inspect natural-language text with keyword rules.
 */
export class ScopeTriggerDetector {
    public detectExplicitIntent(actions: MemoryAction[], config: ScopeTriggerConfig = {}): ScopeTriggerResult {
        const threshold = config.explicitThreshold ?? DEFAULTS.explicitThreshold;
        let scopeScore = 0;
        let scopeEventScore = 0;
        for (const action of actions) {
            const signals = action.signals as { scopeIntent?: number; scopeEventIntent?: number } | undefined;
            const scope = this.clamp01(signals?.scopeIntent ?? 0);
            const scopeEvent = this.clamp01(signals?.scopeEventIntent ?? 0);
            if (scope > scopeScore) scopeScore = scope;
            if (scopeEvent > scopeEventScore) scopeEventScore = scopeEvent;
        }
        if (scopeScore >= threshold && scopeScore >= scopeEventScore) {
            return {
                kind: ScopeTriggerKind.ExplicitScope,
                score: scopeScore,
                relatedIds: [],
                rationale: "explicit-scope-intent",
            };
        }
        if (scopeEventScore >= threshold) {
            return {
                kind: ScopeTriggerKind.ExplicitScopeEvent,
                score: scopeEventScore,
                relatedIds: [],
                rationale: "explicit-scope-event-intent",
            };
        }
        return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "no-explicit" };
    }

    /** 显式技能固化意图（独立通道，避免与 scope/event 互相挤压）。 */
    public detectExplicitSkillIntent(actions: MemoryAction[], config: ScopeTriggerConfig = {}): ScopeTriggerResult {
        const threshold = config.explicitThreshold ?? DEFAULTS.explicitThreshold;
        let score = 0;
        for (const action of actions) {
            const signals = action.signals as { skillPromotionIntent?: number } | undefined;
            const s = this.clamp01(signals?.skillPromotionIntent ?? 0);
            if (s > score) score = s;
        }
        if (score >= threshold) {
            return {
                kind: ScopeTriggerKind.ExplicitSkill,
                score,
                relatedIds: [],
                rationale: "explicit-skill-intent",
            };
        }
        return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "no-explicit-skill" };
    }

    public detectClusterCandidate(cluster: ConceptCluster, config: ScopeTriggerConfig = {}): ScopeTriggerResult {
        const sizeMin = config.scopeInitThreshold ?? DEFAULTS.scopeInitThreshold;
        const evidenceMin = config.clusterEvidenceMin ?? DEFAULTS.clusterEvidenceMin;
        if (cluster.episodes.length < sizeMin) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "cluster-too-small" };
        }
        const distinctTurns = this.countDistinctTurns(cluster.episodes);
        if (distinctTurns < 2) {
            return {
                kind: ScopeTriggerKind.None,
                score: 0,
                relatedIds: [],
                rationale: "single-turn-cluster",
            };
        }
        const hasConverged = cluster.episodes.some(
            (e) => e.sourceKind === MemorySourceKind.BlackboardConverged || e.sourceKind === MemorySourceKind.McpAugmented,
        );
        if (!hasConverged) {
            return {
                kind: ScopeTriggerKind.None,
                score: 0,
                relatedIds: [],
                rationale: "no-converged-evidence",
            };
        }
        const evidence = this.clusterEvidenceScore(cluster);
        if (evidence <= evidenceMin) {
            return {
                kind: ScopeTriggerKind.None,
                score: evidence,
                relatedIds: [],
                rationale: "evidence-below-threshold",
            };
        }
        return {
            kind: ScopeTriggerKind.ClusterCandidate,
            score: evidence,
            relatedIds: cluster.episodes.map((e) => e.episodeId),
            rationale: "cluster-meets-criteria",
        };
    }

    public clusterEvidenceScore(cluster: ConceptCluster): number {
        if (cluster.episodes.length === 0) return 0;
        let total = 0;
        let convergedBoost = 0;
        for (const ep of cluster.episodes) {
            total += this.clamp01(ep.importance);
            if (ep.sourceKind === MemorySourceKind.BlackboardConverged || ep.sourceKind === MemorySourceKind.McpAugmented) {
                convergedBoost += 0.1;
            }
        }
        return this.clamp01(total / cluster.episodes.length + convergedBoost);
    }

    public detectSkillPromotion(
        skill: SkillPromotionCandidate,
        config: ScopeTriggerConfig = {},
    ): ScopeTriggerResult {
        const supportMin = config.skillSupportMin ?? DEFAULTS.skillSupportMin;
        const confMin = config.skillConfidenceMin ?? DEFAULTS.skillConfidenceMin;
        if (skill.support >= supportMin && skill.confidence > confMin) {
            return {
                kind: ScopeTriggerKind.SkillPromotion,
                score: this.clamp01((skill.support / 10) * 0.5 + skill.confidence * 0.5),
                relatedIds: [skill.id],
                rationale: "skill-meets-promotion-thresholds",
            };
        }
        return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "below-thresholds" };
    }

    public detectSkillCandidate(cluster: SkillClusterInput, config: ScopeTriggerConfig = {}): ScopeTriggerResult {
        const supportMin = config.skillSupportMin ?? DEFAULTS.skillSupportMin;
        const confMin = config.skillConfidenceMin ?? DEFAULTS.skillConfidenceMin;
        if (cluster.tools.length === 0) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "no-tools" };
        }
        if (cluster.episodes.length < supportMin) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "support-too-low" };
        }
        let importanceSum = 0;
        let mcpSuccessCount = 0;
        for (const ep of cluster.episodes) {
            importanceSum += this.clamp01(ep.importance);
            if (ep.sourceKind === MemorySourceKind.McpAugmented) mcpSuccessCount += 1;
        }
        const meanImportance = importanceSum / cluster.episodes.length;
        if (meanImportance <= confMin) {
            return { kind: ScopeTriggerKind.None, score: meanImportance, relatedIds: [], rationale: "confidence-too-low" };
        }
        if (mcpSuccessCount < Math.ceil(supportMin / 2)) {
            return {
                kind: ScopeTriggerKind.None,
                score: meanImportance,
                relatedIds: [],
                rationale: "mcp-evidence-too-thin",
            };
        }
        return {
            kind: ScopeTriggerKind.SkillCandidate,
            score: this.clamp01(meanImportance * 0.5 + Math.min(1, cluster.episodes.length / (supportMin * 2)) * 0.5),
            relatedIds: cluster.episodes.map((e) => e.episodeId),
            rationale: "skill-cluster-meets-criteria",
        };
    }

    public detectCodenamePromotion(
        record: CodenamePromotionInput,
        config: ScopeTriggerConfig = {},
        nowMs: number = Date.now(),
    ): ScopeTriggerResult {
        if (record.scopeId) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "already-promoted" };
        }
        const useMin = config.codenameUseCountMin ?? DEFAULTS.codenameUseCountMin;
        const ageMin = config.codenameMinAgeMs ?? DEFAULTS.codenameMinAgeMs;
        if (record.useCount < useMin) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [record.id], rationale: "use-count-too-low" };
        }
        const ageMs = nowMs - record.createdAt;
        if (ageMs < ageMin) {
            return { kind: ScopeTriggerKind.None, score: 0, relatedIds: [record.id], rationale: "too-young" };
        }
        return {
            kind: ScopeTriggerKind.CodenamePromotion,
            score: this.clamp01(record.useCount / (useMin * 2)),
            relatedIds: [record.id],
            rationale: "codename-meets-promotion-thresholds",
        };
    }

    private countDistinctTurns(episodes: EpisodeRecord[]): number {
        const buckets = new Set<number>();
        for (const ep of episodes) {
            buckets.add(Math.floor(ep.createdAt / (60 * 60 * 1000)));
        }
        return buckets.size;
    }

    private clamp01(value: number): number {
        if (Number.isNaN(value)) return 0;
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }
}

export const scopeTriggerDetector = new ScopeTriggerDetector();

export function detectExplicitIntent(actions: MemoryAction[], config: ScopeTriggerConfig = {}): ScopeTriggerResult {
    return scopeTriggerDetector.detectExplicitIntent(actions, config);
}

export function detectExplicitSkillIntent(actions: MemoryAction[], config: ScopeTriggerConfig = {}): ScopeTriggerResult {
    return scopeTriggerDetector.detectExplicitSkillIntent(actions, config);
}

export function detectClusterCandidate(cluster: ConceptCluster, config: ScopeTriggerConfig = {}): ScopeTriggerResult {
    return scopeTriggerDetector.detectClusterCandidate(cluster, config);
}

export function clusterEvidenceScore(cluster: ConceptCluster): number {
    return scopeTriggerDetector.clusterEvidenceScore(cluster);
}

export function detectSkillPromotion(
    skill: SkillPromotionCandidate,
    config: ScopeTriggerConfig = {},
): ScopeTriggerResult {
    return scopeTriggerDetector.detectSkillPromotion(skill, config);
}

export function detectSkillCandidate(cluster: SkillClusterInput, config: ScopeTriggerConfig = {}): ScopeTriggerResult {
    return scopeTriggerDetector.detectSkillCandidate(cluster, config);
}

export function detectCodenamePromotion(
    record: CodenamePromotionInput,
    config: ScopeTriggerConfig = {},
    nowMs: number = Date.now(),
): ScopeTriggerResult {
    return scopeTriggerDetector.detectCodenamePromotion(record, config, nowMs);
}

/**
 * 项目/事件固化触发器（project-module）。
 *
 * 三条触发路径（与 README.md §10 事件与项目固化对齐）：
 *
 *   A 显式用户意图（最高优先级）
 *     由模型在 memory action 的 signals 中给出 projectIntent / eventIntent ∈ [0,1]，
 *     ≥ 0.7 即视为显式意图，立即固化（不等 cluster）。
 *
 *   B 概念 cluster 自动触发（被动识别）
 *     某 userId 下若存在一组 episode：
 *       - cluster_size >= projectInitThreshold（默认 5）
 *       - 跨越 ≥ 2 次不同 turn（用 createdAt 离散度近似）
 *       - 至少有 1 条 sourceKind = blackboard-converged 或 mcp-augmented
 *       - cluster evidence_score > 0.5
 *     → 触发 project-candidate（由调用方通过 decision form 询问用户确认）。
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

export const ProjectTriggerKind = {
    ExplicitProject: "explicit-project",
    ExplicitEvent: "explicit-event",
    ExplicitSkill: "explicit-skill",
    ClusterCandidate: "cluster-candidate",
    SkillCandidate: "skill-candidate",
    SkillPromotion: "skill-promotion",
    CodenamePromotion: "codename-promotion",
    None: "none",
} as const;
export type ProjectTriggerKind = (typeof ProjectTriggerKind)[keyof typeof ProjectTriggerKind];

export interface ProjectTriggerResult {
    kind: ProjectTriggerKind;
    score: number;
    relatedIds: string[];
    rationale: string;
}

export interface ProjectTriggerConfig {
    explicitThreshold?: number;
    projectInitThreshold?: number;
    clusterEvidenceMin?: number;
    skillSupportMin?: number;
    skillConfidenceMin?: number;
    /** LF-R2 codename promotion: useCount threshold (default 5). */
    codenameUseCountMin?: number;
    /** LF-R2 codename promotion: minimum age in ms before auto-promotion (default 1h). */
    codenameMinAgeMs?: number;
}

const DEFAULTS: Required<ProjectTriggerConfig> = {
    explicitThreshold: 0.7,
    projectInitThreshold: 5,
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
    projectId?: string;
}

/**
 * Numeric project/skill/codename trigger detector.
 *
 * The detector only consumes model-emitted numeric signals and resource
 * metrics. It must never inspect natural-language text with keyword rules.
 */
export class ProjectTriggerDetector {
    public detectExplicitIntent(actions: MemoryAction[], config: ProjectTriggerConfig = {}): ProjectTriggerResult {
        const threshold = config.explicitThreshold ?? DEFAULTS.explicitThreshold;
        let projectScore = 0;
        let eventScore = 0;
        for (const action of actions) {
            const signals = action.signals as { projectIntent?: number; eventIntent?: number } | undefined;
            const p = this.clamp01(signals?.projectIntent ?? 0);
            const e = this.clamp01(signals?.eventIntent ?? 0);
            if (p > projectScore) projectScore = p;
            if (e > eventScore) eventScore = e;
        }
        if (projectScore >= threshold && projectScore >= eventScore) {
            return {
                kind: ProjectTriggerKind.ExplicitProject,
                score: projectScore,
                relatedIds: [],
                rationale: "explicit-project-intent",
            };
        }
        if (eventScore >= threshold) {
            return {
                kind: ProjectTriggerKind.ExplicitEvent,
                score: eventScore,
                relatedIds: [],
                rationale: "explicit-event-intent",
            };
        }
        return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "no-explicit" };
    }

    /** 显式技能固化意图（独立通道，避免与 project/event 互相挤压）。 */
    public detectExplicitSkillIntent(actions: MemoryAction[], config: ProjectTriggerConfig = {}): ProjectTriggerResult {
        const threshold = config.explicitThreshold ?? DEFAULTS.explicitThreshold;
        let score = 0;
        for (const action of actions) {
            const signals = action.signals as { skillPromotionIntent?: number } | undefined;
            const s = this.clamp01(signals?.skillPromotionIntent ?? 0);
            if (s > score) score = s;
        }
        if (score >= threshold) {
            return {
                kind: ProjectTriggerKind.ExplicitSkill,
                score,
                relatedIds: [],
                rationale: "explicit-skill-intent",
            };
        }
        return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "no-explicit-skill" };
    }

    public detectClusterCandidate(cluster: ConceptCluster, config: ProjectTriggerConfig = {}): ProjectTriggerResult {
        const sizeMin = config.projectInitThreshold ?? DEFAULTS.projectInitThreshold;
        const evidenceMin = config.clusterEvidenceMin ?? DEFAULTS.clusterEvidenceMin;
        if (cluster.episodes.length < sizeMin) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "cluster-too-small" };
        }
        const distinctTurns = this.countDistinctTurns(cluster.episodes);
        if (distinctTurns < 2) {
            return {
                kind: ProjectTriggerKind.None,
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
                kind: ProjectTriggerKind.None,
                score: 0,
                relatedIds: [],
                rationale: "no-converged-evidence",
            };
        }
        const evidence = this.clusterEvidenceScore(cluster);
        if (evidence <= evidenceMin) {
            return {
                kind: ProjectTriggerKind.None,
                score: evidence,
                relatedIds: [],
                rationale: "evidence-below-threshold",
            };
        }
        return {
            kind: ProjectTriggerKind.ClusterCandidate,
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
        config: ProjectTriggerConfig = {},
    ): ProjectTriggerResult {
        const supportMin = config.skillSupportMin ?? DEFAULTS.skillSupportMin;
        const confMin = config.skillConfidenceMin ?? DEFAULTS.skillConfidenceMin;
        if (skill.support >= supportMin && skill.confidence > confMin) {
            return {
                kind: ProjectTriggerKind.SkillPromotion,
                score: this.clamp01((skill.support / 10) * 0.5 + skill.confidence * 0.5),
                relatedIds: [skill.id],
                rationale: "skill-meets-promotion-thresholds",
            };
        }
        return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "below-thresholds" };
    }

    public detectSkillCandidate(cluster: SkillClusterInput, config: ProjectTriggerConfig = {}): ProjectTriggerResult {
        const supportMin = config.skillSupportMin ?? DEFAULTS.skillSupportMin;
        const confMin = config.skillConfidenceMin ?? DEFAULTS.skillConfidenceMin;
        if (cluster.tools.length === 0) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "no-tools" };
        }
        if (cluster.episodes.length < supportMin) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "support-too-low" };
        }
        let importanceSum = 0;
        let mcpSuccessCount = 0;
        for (const ep of cluster.episodes) {
            importanceSum += this.clamp01(ep.importance);
            if (ep.sourceKind === MemorySourceKind.McpAugmented) mcpSuccessCount += 1;
        }
        const meanImportance = importanceSum / cluster.episodes.length;
        if (meanImportance <= confMin) {
            return { kind: ProjectTriggerKind.None, score: meanImportance, relatedIds: [], rationale: "confidence-too-low" };
        }
        if (mcpSuccessCount < Math.ceil(supportMin / 2)) {
            return {
                kind: ProjectTriggerKind.None,
                score: meanImportance,
                relatedIds: [],
                rationale: "mcp-evidence-too-thin",
            };
        }
        return {
            kind: ProjectTriggerKind.SkillCandidate,
            score: this.clamp01(meanImportance * 0.5 + Math.min(1, cluster.episodes.length / (supportMin * 2)) * 0.5),
            relatedIds: cluster.episodes.map((e) => e.episodeId),
            rationale: "skill-cluster-meets-criteria",
        };
    }

    public detectCodenamePromotion(
        record: CodenamePromotionInput,
        config: ProjectTriggerConfig = {},
        nowMs: number = Date.now(),
    ): ProjectTriggerResult {
        if (record.projectId) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "already-promoted" };
        }
        const useMin = config.codenameUseCountMin ?? DEFAULTS.codenameUseCountMin;
        const ageMin = config.codenameMinAgeMs ?? DEFAULTS.codenameMinAgeMs;
        if (record.useCount < useMin) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [record.id], rationale: "use-count-too-low" };
        }
        const ageMs = nowMs - record.createdAt;
        if (ageMs < ageMin) {
            return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [record.id], rationale: "too-young" };
        }
        return {
            kind: ProjectTriggerKind.CodenamePromotion,
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

export const projectTriggerDetector = new ProjectTriggerDetector();

export function detectExplicitIntent(actions: MemoryAction[], config: ProjectTriggerConfig = {}): ProjectTriggerResult {
    return projectTriggerDetector.detectExplicitIntent(actions, config);
}

export function detectExplicitSkillIntent(actions: MemoryAction[], config: ProjectTriggerConfig = {}): ProjectTriggerResult {
    return projectTriggerDetector.detectExplicitSkillIntent(actions, config);
}

export function detectClusterCandidate(cluster: ConceptCluster, config: ProjectTriggerConfig = {}): ProjectTriggerResult {
    return projectTriggerDetector.detectClusterCandidate(cluster, config);
}

export function clusterEvidenceScore(cluster: ConceptCluster): number {
    return projectTriggerDetector.clusterEvidenceScore(cluster);
}

export function detectSkillPromotion(
    skill: SkillPromotionCandidate,
    config: ProjectTriggerConfig = {},
): ProjectTriggerResult {
    return projectTriggerDetector.detectSkillPromotion(skill, config);
}

export function detectSkillCandidate(cluster: SkillClusterInput, config: ProjectTriggerConfig = {}): ProjectTriggerResult {
    return projectTriggerDetector.detectSkillCandidate(cluster, config);
}

export function detectCodenamePromotion(
    record: CodenamePromotionInput,
    config: ProjectTriggerConfig = {},
    nowMs: number = Date.now(),
): ProjectTriggerResult {
    return projectTriggerDetector.detectCodenamePromotion(record, config, nowMs);
}

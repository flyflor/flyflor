/**
 * 项目/事件固化触发器（project-module）。
 *
 * 三条触发路径（与 DESIGN.md §10 事件与项目固化对齐）：
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
 * 严格遵守 docs/boundaries.md "业务语义零字符串匹配"——
 * 三条路径全部用资源指标（signals 数值 / cluster 大小 / cosine / support / confidence）判定，
 * 没有任何 text.includes / 正则 / 关键词。
 */

import type { MemoryAction } from "../../neural/memory/actions.ts";
import type { EpisodeRecord } from "../../neural/memory/redis.ts";
import { MemorySourceKind } from "../../protocol/contracts/index.ts";

export const ProjectTriggerKind = {
    ExplicitProject: "explicit-project",
    ExplicitEvent: "explicit-event",
    ClusterCandidate: "cluster-candidate",
    SkillPromotion: "skill-promotion",
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
}

const DEFAULTS: Required<ProjectTriggerConfig> = {
    explicitThreshold: 0.7,
    projectInitThreshold: 5,
    clusterEvidenceMin: 0.5,
    skillSupportMin: 5,
    skillConfidenceMin: 0.7,
};

// ─── 路径 A: 显式意图 ──────────────────────────────────────────────

export function detectExplicitIntent(
    actions: MemoryAction[],
    config: ProjectTriggerConfig = {},
): ProjectTriggerResult {
    const threshold = config.explicitThreshold ?? DEFAULTS.explicitThreshold;
    let projectScore = 0;
    let eventScore = 0;
    for (const action of actions) {
        const signals = action.signals as
            | { projectIntent?: number; eventIntent?: number }
            | undefined;
        const p = clamp01(signals?.projectIntent ?? 0);
        const e = clamp01(signals?.eventIntent ?? 0);
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

// ─── 路径 B: cluster 自动识别 ─────────────────────────────────────

export interface ConceptCluster {
    concepts: string[];
    episodes: EpisodeRecord[];
}

export function detectClusterCandidate(
    cluster: ConceptCluster,
    config: ProjectTriggerConfig = {},
): ProjectTriggerResult {
    const sizeMin = config.projectInitThreshold ?? DEFAULTS.projectInitThreshold;
    const evidenceMin = config.clusterEvidenceMin ?? DEFAULTS.clusterEvidenceMin;
    if (cluster.episodes.length < sizeMin) {
        return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "cluster-too-small" };
    }
    const distinctTurns = countDistinctTurns(cluster.episodes);
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
    const evidence = clusterEvidenceScore(cluster);
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

export function clusterEvidenceScore(cluster: ConceptCluster): number {
    if (cluster.episodes.length === 0) return 0;
    let total = 0;
    let convergedBoost = 0;
    for (const ep of cluster.episodes) {
        total += clamp01(ep.importance);
        if (ep.sourceKind === MemorySourceKind.BlackboardConverged || ep.sourceKind === MemorySourceKind.McpAugmented) {
            convergedBoost += 0.1;
        }
    }
    return clamp01(total / cluster.episodes.length + convergedBoost);
}

// ─── 路径 C: 技能升格 ─────────────────────────────────────────────

export interface SkillPromotionCandidate {
    id: string;
    support: number;
    confidence: number;
    summary?: string;
}

export function detectSkillPromotion(
    skill: SkillPromotionCandidate,
    config: ProjectTriggerConfig = {},
): ProjectTriggerResult {
    const supportMin = config.skillSupportMin ?? DEFAULTS.skillSupportMin;
    const confMin = config.skillConfidenceMin ?? DEFAULTS.skillConfidenceMin;
    if (skill.support >= supportMin && skill.confidence > confMin) {
        return {
            kind: ProjectTriggerKind.SkillPromotion,
            score: clamp01((skill.support / 10) * 0.5 + skill.confidence * 0.5),
            relatedIds: [skill.id],
            rationale: "skill-meets-promotion-thresholds",
        };
    }
    return { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "below-thresholds" };
}

// ─── 助手 ──────────────────────────────────────────────────────────

function countDistinctTurns(episodes: EpisodeRecord[]): number {
    const buckets = new Set<number>();
    for (const ep of episodes) {
        buckets.add(Math.floor(ep.createdAt / (60 * 60 * 1000)));
    }
    return buckets.size;
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

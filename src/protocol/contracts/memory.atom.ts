/**
 * Memory Atom 协议（生命体记忆 atom / AtomScore 的公共契约）
 *
 * 设计要点：
 * - Atom 是 episode 的 derived view，episodeIds 至少 1 项；schema 可独立演化，不改写历史。
 * - 抽取分两相：热相（turn 结束、零额外 LLM）与冷相（次日离线、本地模型）。
 * - 三阶段压缩对应 stage 字段：raw / compressed / fuzzy；原文保留在 SQLite 历史层。
 * - LLM 只负责"表达结晶"，是否升格由 AtomScore + Gate A/B/C 系统决定。
 *
 * 这些类型已被 MemoryModule、BrainStore prompt recall 与旧 journal 审计路径共同消费；
 * 新增字段必须保持 JSON 可序列化，并经 `src/protocol/contracts/index.ts` 对外暴露。
 */

import type { ModelRole } from "./enums.ts";

/**
 * Atom 的压缩态：raw=0-3d 原文；compressed=3-7d 抽象经验；fuzzy=7+d 概率性规则。
 * 边界天数由 memory.summary.rollingWindowDays + 内部常量决定，配置层只暴露窗口长度。
 */
export const AtomStage = {
    Raw: "raw",
    Compressed: "compressed",
    Fuzzy: "fuzzy",
} as const;

export type AtomStage = (typeof AtomStage)[keyof typeof AtomStage];

/**
 * identity 自写目标文件。R3 红线：append-only + revertable，禁止覆盖式重写。
 */
export const IdentityFile = {
    Identity: "identity.md",
    User: "user.md",
} as const;

export type IdentityFile = (typeof IdentityFile)[keyof typeof IdentityFile];

/**
 * 单条 Memory Atom：source-of-truth 是 episodeIds 指向的 SQLite 当日记录。
 * Atom 本身落在 `brain.db` 的 `memory_atom` 表中（LF-R1 单库；旧 journal 分文件路径已废）。
 */
export interface MemoryAtom {
    id: string;
    /** 1..N episode id；Atom 是 episode 上的语义视图，原文不入 Atom 表。 */
    episodeIds: string[];
    /** Core continuity owner: scope:<id>, fork:<id>, codename:<id>, or turn:<id>. */
    ownerKey?: string;
    /** Explicit scope id when the atom belongs to a mounted scope. */
    scopeId?: string;
    /** Optional source provenance label; never used as continuity owner. */
    sourceKey?: string;
    /** Optional source surface label; never used as continuity owner. */
    sourceSurface?: string;
    /** @deprecated Legacy scope alias retained for old brain events. Prefer scopeId. */
    projectId?: string;
    /** 主对话角色，决定 spreading activation 与 Confirmation lookup 行为。 */
    role: ModelRole;
    /** 以下五字段由模型同轮结构化输出填充；冷相回填 outcome / success。 */
    task: string;
    context: string;
    problem?: string;
    action: string;
    outcome: string;
    /** 显式成功信号；缺省 = 未知，不算正样本。冷相用次日反馈回填。 */
    success?: boolean;
    /** 0..1，模型自评置信度；与 priorWeight 一起进入 successPrior。 */
    confidence: number;
    /** 现 evidence weight 表（unverified=0..explicit=0.9）的迁移字段，作为 prior。 */
    priorWeight: number;
    /** AtomScore.embedding 维度由 memory.embedding.dimensions 决定，默认 384。 */
    embedding: number[];
    /** 摘要文本，长度随 stage 收缩；冷相重写时落 refinedAt。 */
    text: string;
    stage: AtomStage;
    createdAt: string;
    refinedAt?: string;
}

/**
 * Atom 检索分。R4 红线：所有召回必须先过此分阈值，绕过即边界违规。
 */
export interface AtomScore {
    atomId: string;
    /** 四个分量按 memory.atomScore.weights 加权求和；权重总和不强制为 1。 */
    recency: number;
    access: number;
    successPrior: number;
    fanout: number;
    /** 最终值 = Σ weight × component。 */
    total: number;
    /** inbox 倍率：D5 中 inbox 内 atom 的 recency 衰减 × decayMultiplier。 */
    inboxDecayApplied: boolean;
    /** 用于 doctor / debug 输出，不入决策逻辑。 */
    explain?: string;
}

/**
 * 焦点指针：表达"现在用户和 agent 在干什么"。
 * 存于 brain/state 层或本地运行时状态。无活动超过 idle.idleMinutes 后回落 inbox。
 */
export interface FocusPointer {
    /** Core continuity owner: scope:<id>, fork:<id>, codename:<id>, or turn:<id>. */
    ownerKey: string;
    /** Explicit mounted scope when focus is scope-local. */
    scopeId?: string;
    /** Explicit fork when focus follows a context branch. */
    contextForkId?: string;
    /** Codename anchor boost, never an implicit context container. */
    codenameId?: string;
    /** Optional source provenance label; never used as continuity owner. */
    sourceKey?: string;
    /** Optional source surface label; never used as continuity owner. */
    sourceSurface?: string;
    /** @deprecated Legacy scope alias retained for old snapshots. */
    projectId?: string;
    sinceTs: string;
    lastTouchTs: string;
    /** RuntimeMode 切换由此判断；Idle 期间 lastTouchTs 不更新。 */
    awake: boolean;
}

/**
 * Legacy identity self-write audit shape retained for old structured blocks.
 * The active Markdown constitution lives under config workspace canonical files.
 */
export interface IdentityAppendEntry {
    entryId: string;
    file: IdentityFile;
    appendedAt: string;
    /** 触发此次 append 的 atom ids；同一次自写可关联多个 atom。 */
    atomIds: string[];
    /** SHA-256，用于一键 revert 时比对当前文件状态。 */
    beforeHash: string;
    afterHash: string;
    /** append 的纯文本（含 markdown），不含周边上下文。 */
    appendedText: string;
    /** 用户 revert 后回写为 true；同时反向写一条 reverted-by-user 标记 atom。 */
    reverted: boolean;
    revertedAt?: string;
    /** 同日同文件已 append 次数（含本条），用于命中 daily limit 的快速校验。 */
    sequenceInDay: number;
}

/**
 * 周自述触发模式。
 * - rolling：滚动 7 天窗口（生命体直觉，无周末效应）
 * - calendar：周日 00:00 节拍（工程简单）
 */
export const SummaryTrigger = {
    Rolling: "rolling",
    Calendar: "calendar",
} as const;

export type SummaryTrigger = (typeof SummaryTrigger)[keyof typeof SummaryTrigger];

/**
 * Reconsolidation 队列项：Dream worker 第 4 类动作的入参。
 * 触发条件：现有 gem 被命中，但当前 atom 与 gem 中位 embedding cosine 距离 ≥ driftHitThreshold；
 * 累计命中 ≥ driftHitCount 才入队（避免单次扰动）。
 */
export interface ReconsolidationCandidate {
    gemId: string;
    /** 偏离命中的最新 atom；用于 LLM 生成"修正版" gem 时的新证据。 */
    driftAtomIds: string[];
    /** 累计偏离次数；满足 driftHitCount 才入队。 */
    driftHitCount: number;
    /** 计算时使用的 cosine 距离均值。 */
    meanDriftDistance: number;
    enqueuedAt: string;
}

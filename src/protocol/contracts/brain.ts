/**
 * Brain.db 协议（生命体重构 LF-R1 协议层，未消费）
 *
 * 设计要点（详见 `docs/proposals/life.form.md` §brain.db Schema）：
 * - `~/.flyflor/brain.db` 是单文件大脑：event/state 分离 + append-only。
 * - `memory_events`：append-only 事件层。任何"更新内容"操作必须新写一行 + 状态层指向。
 * - `memory_state`：状态层。Dream / sweeper 只允许改这里，不得 DELETE event 行。
 * - `memory_summary`：日 / 周级摘要，取代旧 `week.summary.md`。
 * - `memory_links`：dream / reflection 形成的隐含链接（contradicts / causal / derived / similarity）。
 * - `codenames`：用户显式工作目录锚点；频次衰减自然上浮，可升格为 Project。
 *
 * 本文件只声明类型与枚举常量，runtime / store / worker 不在本阶段引用。
 */

import type { ModelRole } from "./enums.ts";

/**
 * `memory_events.type`。生命体所有"发生过的事"都落在 events 表的一行，
 * type 字段区分事件子类，零字符匹配（不允许 runtime 用 `text.includes` 派生类型）。
 */
export const MemoryEventType = {
    /** 用户 / agent / tool / system 的对话事件。 */
    Event: "event",
    /** 黑板内部 worker 的思维内容（不进 prompt 默认召回，仅作审计）。 */
    Thought: "thought",
    /** 工具调用 / sandbox 决策等可观察行为。 */
    Action: "action",
    /** Reflection 候选 → atom 派生事件。 */
    Reflection: "reflection",
    /** Ghost Context 快照（LF-R4）。`parent_id` 指向被 fork 的原事件。 */
    GhostContext: "ghost-context",
    /** Pending ask（LF-R3）：模型同轮 kind='ask' 输出的反问事件。`parent_id` 指向上一轮触发它的 event。 */
    Ask: "ask",
    /** Ask-Answer 配对（LF-R3）。`parent_id` 指向触发它的 ghost / 原 ask 事件。 */
    AskAnswerPair: "ask-answer-pair",
    /** Identity self-write append。 */
    IdentityAppend: "identity-append",
} as const;

export type MemoryEventType = (typeof MemoryEventType)[keyof typeof MemoryEventType];

/**
 * `memory_state.status`。状态层的可变枚举，限定 Dream / sweeper 写入面。
 */
export const MemoryEventStatus = {
    /** 默认。参与召回、衰减、AtomScore 计算。 */
    Live: "live",
    /** Ghost 被显式 resume 后的标记，importance 拉回峰值。 */
    Resumed: "resumed",
    /** Pending ask 被用户新输入 cancel；evidence weight = 0，不参与晶体升格。 */
    Abandoned: "abandoned",
    /** 月级冷归档已外迁到 archive/brain.YYYY-MM.db。 */
    Archived: "archived",
} as const;

export type MemoryEventStatus = (typeof MemoryEventStatus)[keyof typeof MemoryEventStatus];

/**
 * `memory_links.type`。Dream 写操作的唯一合法 evidence 来源（R7：只放大不创造）。
 */
export const MemoryLinkType = {
    Similarity: "similarity",
    Causal: "causal",
    Derived: "derived",
    Contradicts: "contradicts",
} as const;

export type MemoryLinkType = (typeof MemoryLinkType)[keyof typeof MemoryLinkType];

/**
 * `memory_summary.time_range`。日级 / 周级粒度。
 */
export const SummaryRange = {
    Day: "day",
    Week: "week",
    Month: "month",
} as const;

export type SummaryRange = (typeof SummaryRange)[keyof typeof SummaryRange];

/**
 * Event 行：append-only。`content` 是 JSON 字符串（在协议层暴露为结构化 record）。
 */
export interface MemoryEventRecord {
    id: string;
    /** epoch milliseconds。所有时间字段使用 ms，便于跨语言 / 索引。 */
    ts: number;
    /** YYYY-MM-DD（UTC）。R1 索引列。 */
    timeBucket: string;
    userId: string;
    channelId?: string;
    codenameId?: string;
    type: MemoryEventType;
    role?: ModelRole;
    /** 序列化为 SQLite TEXT 列时使用 `JSON.stringify`；协议层保持结构化。 */
    content: Record<string, unknown>;
    /** Ghost 链 / ask-answer 配对的反向引用。 */
    parentId?: string;
    embeddingId?: string;
    importance: number;
}

/**
 * State 行：可变。每条 event 至多一条 state；不存在时按"默认 live"解释。
 */
export interface MemoryStateRecord {
    eventId: string;
    activation: number;
    decayScore: number;
    accessCount: number;
    lastAccessed?: number;
    /** Ghost 专用：成功 resume 的时间戳。 */
    resumedAt?: number;
    status: MemoryEventStatus;
}

/**
 * Summary 行：weekly / daily summary worker（LF-R5）的写入目标，
 * 取代旧 `week.summary.md` 平铺文本。
 */
export interface MemorySummaryRecord {
    id: string;
    timeRange: SummaryRange;
    /** YYYY-MM-DD 或 YYYY-Www，与 timeRange 对应。 */
    bucketKey: string;
    content: string;
    embeddingId?: string;
    createdAt: number;
}

/**
 * Link 行：Dream 候选的合法 evidence。strength ∈ [0, 1]。
 */
export interface MemoryLinkRecord {
    id: string;
    fromId: string;
    toId: string;
    strength: number;
    type: MemoryLinkType;
    createdAt: number;
}

/**
 * Codename：用户显式工作目录锚点。`@xxx` 强绑定；多候选触发 Ask；
 * `useCount + lastUsedAt` 进 AtomScore 自然上浮；满足条件升格为 Project。
 */
export interface CodenameRecord {
    id: string;
    name: string;
    workingDir?: string;
    /** 模型同轮生成的一句话摘要（R6：零字符匹配，runtime 不规则拼接）。 */
    description?: string;
    userId: string;
    createdAt: number;
    lastUsedAt: number;
    useCount: number;
    /** 升格后绑定 `projects/<projectId>/`。未升格则 undefined。 */
    projectId?: string;
}

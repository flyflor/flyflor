/**
 * Brain.db 协议（单文件大脑 event/state/summary/link/codename 公共契约）
 *
 * 设计要点（详见 `docs/proposals/life.form.md` §brain.db Schema）：
 * - `~/.flyflor/brain.db` 是单文件大脑：event/state 分离 + append-only。
 * - `memory_events`：append-only 事件层。任何"更新内容"操作必须新写一行 + 状态层指向。
 * - `memory_state`：状态层。Dream / sweeper 只允许改这里，不得 DELETE event 行。
 * - `memory_summary`：日 / 周级摘要，取代旧 `week.summary.md`。
 * - `memory_links`：dream / reflection 形成的隐含链接（contradicts / causal / derived / similarity）。
 * - `codenames`：用户显式工作目录锚点；频次衰减自然上浮，可升格为 Project。
 *
 * 本文件是 memory runtime、BrainStore、doctor/status 与归档工具共享的协议边界；
 * 新增事件类型必须仍可 JSON 序列化，且不得通过字符串语义解析派生。
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
    /** LF-R11：单轮行为快照，用于回放输入、触发源、输出与后续纠正证据。 */
    BehaviorSnapshot: "behavior-snapshot",
    /** LF-R11：用户后续反馈 / 纠正对某条 behavior-snapshot 的结构化证据。 */
    BehaviorCorrection: "behavior-correction",
    /** Redis 热记忆到期清理前的隔离压缩审计；不进 prompt recall / summary / SurrealDB。 */
    HotMemoryCompression: "hot-memory-compression",
} as const;

export type MemoryEventType = (typeof MemoryEventType)[keyof typeof MemoryEventType];

/**
 * 热记忆压缩触发原因。只描述资源/调度来源，不承载业务语义判断。
 */
export const HotMemoryCompressionReason = {
    ReviewDue: "review-due",
    CapacityPressure: "capacity-pressure",
    Manual: "manual",
} as const;

export type HotMemoryCompressionReason =
    (typeof HotMemoryCompressionReason)[keyof typeof HotMemoryCompressionReason];

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
 * LF-R11 Behavior Snapshot：每轮完成后写入一条 append-only event。
 * 只保存结构化触发面和短文本预览；不把完整 prompt、工具输出或日志塞进 brain.db。
 */
export interface BehaviorSnapshotContent {
    snapshotId: string;
    requestId?: string;
    input: {
        messageId: string;
        textPreview: string;
        channel: string;
        chatId: string;
        chatType?: string;
        receivedAt?: string;
    };
    triggers: {
        memoryActions: number;
        ask?: {
            reason: string;
            choices: number;
            questions?: number;
        };
        blackboard?: {
            mode: string;
            reason: string;
            status?: string;
            turnId?: string;
        };
        mcpToolCalls: number;
        mcpToolFailures: number;
        skills: string[];
        sandboxMode?: string;
    };
    output: {
        kind: "reply" | "ask";
        textPreview: string;
        visibleTextPreview?: string;
    };
}

/** 用户后续纠正 / 确认对 behavior snapshot 的证据。 */
export interface BehaviorCorrectionContent {
    snapshotId: string;
    requestId?: string;
    category: string;
    hasFact: boolean;
    factPreview?: string;
    currentUserTextPreview: string;
    previousAssistantTextPreview: string;
}

/**
 * Redis 热记忆压缩审计事件内容。
 *
 * 约束：这是短期工作记忆清理记录，不是长期摘要，不生成 prompt atoms，也不作为
 * SurrealDB / candidate 的默认输入。未来若要把它升为证据，必须走显式 gate。
 */
export interface HotMemoryCompressionContent {
    batchId: string;
    userId: string;
    reason: HotMemoryCompressionReason;
    sourceEpisodeIds: string[];
    deletedEpisodeIds: string[];
    missingEpisodeIds: string[];
    compressedText: string;
    retainedSignals: string[];
    sourceStats: {
        count: number;
        oldestCreatedAt?: number;
        newestCreatedAt?: number;
        minImportance?: number;
        maxImportance?: number;
    };
    isolation: {
        promptVisible: false;
        memorySummary: false;
        surrealCandidate: false;
        gemCandidate: false;
    };
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

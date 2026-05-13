/**
 * Ghost Context 协议（生命体重构 LF-R4）。
 *
 * 设计要点（详见 `docs/proposals/life.form.md` §D6 & §R4）：
 * - Ghost 不是新概念，是 `memory_events.type = 'ghost-context'` 的一种。
 *   复用 AtomScore / decay / 召回 / gem 升格通路，零新机制。
 * - Ghost 由 runtime 在以下场景写入：
 *   ① ask 触发（reason='ask'，parent_id 指向 ask event）；
 *   ② 工具失败（reason='tool-failure'）；
 *   ③ 黑板封顶（reason='blackboard-cap'）；
 *   ④ 进程异常重启（reason='process-restart'）。
 * - `userFacing.{title,askPrompt,contextHint}` 由模型同轮结构化输出，
 *   runtime 不解析对话文本派生（业务语义零字符匹配红线）。缺省时取 ask.prompt 首行。
 * - 用户面行为：可见（TUI 侧栏 + CLI `flyflor ghost *`）、可 resume / drop / pin。
 *   Abandoned ghost 不进晶体；resume 成功的 ghost 是 gem 升格高价值证据。
 */

import type { AgentAsk } from "./ask.ts";

export const GhostContextReason = {
    /** 由 ask 触发：模型同轮反问 → runtime 把 ask 快照成 ghost。 */
    Ask: "ask",
    /** MCP / sandbox 工具失败：保留 in-flight 上下文。 */
    ToolFailure: "tool-failure",
    /** 黑板硬封顶：留待用户决断。 */
    BlackboardCap: "blackboard-cap",
    /** 进程异常重启：尚未持久化的 turn 上下文。 */
    ProcessRestart: "process-restart",
} as const;

export type GhostContextReason = (typeof GhostContextReason)[keyof typeof GhostContextReason];

/**
 * Ghost 用户面字段（CLI / TUI / 渠道展示来源）。
 * 严禁 runtime 解析对话文本派生这些字段；只能来自模型同轮结构化输出
 * 或在没有模型输出时退化为 ask.prompt 首行（短路 fallback 不算字符匹配）。
 */
export interface GhostUserFacing {
    /** 列表行短标题（建议 < 60 字）。 */
    title: string;
    /** 该 ghost 对应的 ask prompt 原文（便于用户秒回上下文）。 */
    askPrompt?: string;
    /** 一行上下文提示（可选，用于 TUI 详情）。 */
    contextHint?: string;
}

/**
 * Ghost snapshot：被中断 turn 的上下文快照，resume 时用作 prompt 重建依据。
 * 字段可选；缺省值时不影响 ghost 列表展示，只影响 resume 上下文完整性。
 */
export interface GhostSnapshot {
    /** 触发本 ghost 的原始用户消息文本。 */
    originalUserMessage?: string;
    /** 黑板 turnId（reason='blackboard-cap' 时填）。 */
    blackboardTurnId?: string;
    /** MCP 工具调用进度（reason='tool-failure' 时填）。 */
    mcpCallProgress?: Array<{ tool: string; status: string; lastError?: string }>;
    /** 触发本 ghost 的 ask 对象（reason='ask' 时填）。 */
    askedQuestion?: AgentAsk;
}

/**
 * `memory_events.type='ghost-context'` 行的 content payload。
 */
export interface GhostContextEventContent {
    ghostId: string;
    reason: GhostContextReason;
    userFacing: GhostUserFacing;
    snapshot?: GhostSnapshot;
    /** 关联 codename（按 codename 分组展示）。 */
    codenameId?: string;
    /** 创建本 ghost 的 requestId（审计）。 */
    requestId?: string;
    /**
     * LF-R4 fork/fresh hint：模型已在某轮把本 ghost 标记为 `fork` 或 `fresh`，
     * 表示当前对话不再延续这条 ghost。仅作为 evidence weight 降权依据，
     * 不影响 ghost 可见性（用户仍可手动 resume）。
     */
    continuationCompleted?: boolean;
    /** 最近一次模型给出的 ghost 处理意图（用于审计 + 可视化）。 */
    lastKind?: GhostDecisionKind;
}

/** LF-R4 fork/fresh hint：模型同轮针对单条 ghost 给出的处理意图。 */
export const GhostDecisionKind = {
    /** 当前消息继续延展该 ghost 的话题 → resumeGhost。 */
    Resume: "resume",
    /** 当前消息从该 ghost 分叉为新话题，但保留 ghost 作历史参考 → 降权但保留。 */
    Fork: "fork",
    /** 当前消息明显是全新话题、与该 ghost 无关 → 降权（仍保留可见性）。 */
    Fresh: "fresh",
} as const;

export type GhostDecisionKind = (typeof GhostDecisionKind)[keyof typeof GhostDecisionKind];

/** 模型同轮输出的 ghost 处理决策（每条对应一个活跃 ghost）。 */
export interface GhostDecision {
    ghostId: string;
    kind: GhostDecisionKind;
}

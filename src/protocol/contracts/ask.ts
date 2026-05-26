/**
 * AgentAsk 协议（生命体重构 LF-R3）。
 *
 * 设计要点（当前契约见 `docs/boundaries.md` R5，历史背景见 `docs/old-docs/legacy.architecture.history.md`）：
 * - 模型同轮输出 `ModelTurnOutput.kind: 'reply' | 'ask'`，**互斥**。
 *   `ask` 不再"模拟"暂停态——它就是一次正常 turn 输出，落 `memory_events.type='ask'`，
 *   下一轮 prompt 通过 `[continuation]` 段把它注入回 system 顶部，
 *   用户的下一条消息天然即"答复"，记一条 `ask-answer-pair`。
 * - `AskReason` 枚举固定可枚举触发面，**严禁** runtime 用任何字符匹配 / 关键词推断
 *   是否要 ask；ask 的 reason / choices / freeform 全由模型同轮结构化字段决定
 *   （业务语义零字符匹配红线）。
 * - 沙箱审批与 Ask 正交：sandbox approval 不走 Ask 协议（保持已有审批入口）。
 *   同一 turn 可同时出现一个 ask 和一个 sandbox approval。
 */

export const AskReason = {
    /** 工作目录代号歧义，模型识别出多候选无法决断。 */
    CodenameAmbiguity: "codename-ambiguity",
    /** 模型即将创建新代号、需要用户确认（`@xxx`）。 */
    CodenameCreate: "codename-create",
    /** 用户意图本身不清晰、需要澄清。 */
    UserIntentUnclear: "user-intent-unclear",
    /** 黑板 5 轮硬顶后由 runtime 接管，`flyflor-decision-form` 退役通道。 */
    BlackboardStalemate: "blackboard-stalemate",
    /** 安全性 / 风险性决策需要用户拍板（不是 sandbox approval，而是设计取舍）。 */
    PolicyDecision: "policy-decision",
    /** 其他模型显式声明的反问场景（例如多步任务边界判断）。 */
    Other: "other",
} as const;

export type AskReason = (typeof AskReason)[keyof typeof AskReason];

export const AskAuthority = {
    Normal: "normal",
    Executive: "executive",
    Blackboard: "blackboard",
    Crystal: "crystal",
    Constitutional: "constitutional",
} as const;

export type AskAuthority = (typeof AskAuthority)[keyof typeof AskAuthority];

export const AskSource = {
    Model: "model",
    Executive: "executive",
    Blackboard: "blackboard",
    Scope: "scope",
    Fork: "fork",
    Crystal: "crystal",
    Constitution: "constitution",
    ToolStability: "tool-stability",
} as const;

export type AskSource = (typeof AskSource)[keyof typeof AskSource];

export const AskResumePolicy = {
    Continue: "continue",
    Replan: "replan",
    Fork: "fork",
    Stop: "stop",
    Crystallize: "crystallize",
} as const;

export type AskResumePolicy = (typeof AskResumePolicy)[keyof typeof AskResumePolicy];

export const AskCrystalCandidatePolicy = {
    None: "none",
    Candidate: "candidate",
    ConfirmPromote: "confirm-promote",
} as const;

export type AskCrystalCandidatePolicy =
    (typeof AskCrystalCandidatePolicy)[keyof typeof AskCrystalCandidatePolicy];

export interface AgentAskChoice {
    /** Stable option id for UI selection, audit, and ASK-answer replay. */
    id?: string;
    /** 用户回答时可见的简短标签。模型必须显式给出，禁止 runtime 派生。 */
    label: string;
    /** 该选项被选中时模型期望沿用的代号 / 项目 / 行动等结构化标识。 */
    value?: string;
    /** 可选辅助说明，给用户更多上下文。 */
    description?: string;
    /** Presentation hint only. The canonical recommendation is question.recommendedChoiceId. */
    recommended?: boolean;
    /** Structured execution delta consumed only by the owning ASK source. */
    executionPatch?: Record<string, unknown>;
}

export interface AgentAskOtherOption {
    id: "other";
    label: string;
    freeform: true;
}

export interface AgentAskQuestion {
    /** 可选稳定 id，方便 TUI / 审计 / 回答回挂。 */
    id?: string;
    /** 单个子问题的用户可见文本。 */
    prompt: string;
    /** 该子问题的候选项。 */
    choices?: AgentAskChoice[];
    /** Recommended model choice id. Runtime may default this to the first choice for legacy ASK blocks. */
    recommendedChoiceId?: string;
    /** ASK always keeps an explicit freeform escape hatch for user-owned decisions. */
    other?: AgentAskOtherOption;
    /** Whether the UI should render the fixed other option. Default true. */
    allowOther?: boolean;
    /** 是否允许自由文本回答。默认 true。 */
    freeform?: boolean;
    /** 可选关联标识。 */
    relatedIds?: string[];
    /** 短理由，仅供审计。 */
    rationale?: string;
    /** Whether this answer should become candidate evidence for Crystal. */
    crystalCandidatePolicy?: AskCrystalCandidatePolicy;
}

export interface AgentAsk {
    /** 触发反问的语义类别（受 AskReason 枚举约束）。 */
    reason: AskReason;
    /** ASK 权限层级。缺省为 normal，Executive/Blackboard/Crystal 可升格。 */
    authority?: AskAuthority;
    /** ASK 来源 owner。缺省为 model。 */
    source?: AskSource;
    /** 用户回答后默认恢复策略。 */
    resumePolicy?: AskResumePolicy;
    /** 反问主体文本（用户可读）。runtime 不解析本字段语义。 */
    prompt: string;
    /** 可选的多选项，按模型给出的顺序展示。 */
    choices?: AgentAskChoice[];
    /** 多问题数组：当一次需要问多个点时，按顺序列出。 */
    questions?: AgentAskQuestion[];
    /** 是否允许自由文本回答。默认 true。 */
    freeform?: boolean;
    /** 可选关联标识（codenameId / blackboardTurnId / projectId 等），便于回填上下文。 */
    relatedIds?: string[];
    /** 模型给出的简短理由（debug / 审计用，不影响展示）。 */
    rationale?: string;
    /** Candidate evidence proposed by high-authority ASK sources. Crystal quality gate still decides promotion. */
    crystalCandidates?: Record<string, unknown>[];
    /**
     * Continuation Context hint（LF-R4）。模型同轮显式提供 continuation 的用户可见字段，
     * 避免 runtime 用 ask.prompt 首行做 fallback 截断。runtime 不解析、不推断；
     * 缺省则走 fallback 路径（结构化降级，非字符匹配）。
     */
    continuationHint?: {
        title?: string;
        contextHint?: string;
    };
}

/**
 * 模型同轮输出抽象（reply | ask 互斥）。
 * - `kind === 'reply'`：常规回答。`text` 为模型给出的可见正文。
 * - `kind === 'ask'`：反问。`ask` 必填；`text` 字段保留作降级 fallback（runtime 渲染时
 *   优先使用 `ask.prompt`）。
 */
export type ModelTurnOutput =
    | { kind: "reply"; text: string }
    | { kind: "ask"; ask: AgentAsk; text?: string };

/**
 * Pending ask 在 brain.db 的 content payload 形态。
 * `memory_events.type === 'ask'` 行写入 `JSON.stringify(askEvent)`。
 */
export interface AskEventContent {
    askId: string;
    /** 与 behavior snapshot / answer pair 共用的 turn snapshot id。 */
    snapshotId: string;
    ask: AgentAsk;
    /** 触发本次 ask 的请求 / turn 标识，便于审计。 */
    requestId?: string;
    /** Ask 链深度（首次=1，每次接续 ask 累加）。runtime 用于强制 reply 阈值检查。 */
    chainDepth: number;
}

/**
 * Ask-Answer 配对 payload。`parent_id` 指向触发的 ask event。
 */
export interface AskAnswerPairContent {
    askId: string;
    /** 回挂到发起该 ask 的 turn snapshot id。 */
    snapshotId: string;
    answerText: string;
    /** Structured ASK answer from GatewayMessage.metadata.askAnswer. */
    askAnswer?: AgentAskAnswerPayload;
    /** 用户的原 message id，便于跨表回查。 */
    answerMessageId?: string;
    /** 是否被新输入 cancel（abandoned）。默认 false（正常答复）。 */
    abandoned?: boolean;
}

export interface AgentAskAnswerItem {
    /** Stable question id from AgentAskQuestion.id. */
    questionId?: string;
    /** Stable choice id from AgentAskChoice.id or the fixed other option. */
    choiceId?: string;
    /** User-visible answer text or freeform value, bounded at ingestion. */
    text?: string;
    /** Structured choice value, preserved for the owning ASK source. */
    value?: unknown;
    /** True when the user selected the freeform escape hatch. */
    isOther?: boolean;
}

export interface AgentAskAnswerPayload extends AgentAskAnswerItem {
    /** Batched multi-question answers. */
    answers?: AgentAskAnswerItem[];
}

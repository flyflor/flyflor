/**
 * Identity self-write 协议（生命体重构 LF-R5）。
 *
 * 设计要点（当前契约见 `docs/boundaries.md` R3，历史背景见 `docs/old-docs/legacy.architecture.history.md`）：
 * - Identity = `memory_events.type = 'identity-append'` 的一系列 append-only 行。
 *   每行携带模型同轮结构化输出的一段自述：偏好、风格、习惯、长期目标、约束等。
 * - 写入完全由模型自决（同轮 `<agent_profile_update>` 块），
 *   runtime 不解析对话文本派生 identity 内容（业务语义零字符匹配红线）。
 * - 可回滚：CLI `flyflor identity revert <id>` 将该行 status 置 `archived`，
 *   后续 `[identity]` prompt 注入会跳过该行。Revert 不删除底层 event 行，
 *   只是把状态层标记，保留全部历史用于审计与 Dream reconsolidation 证据。
 * - 召回路径：`buildPrompt` 在 system 顶部拼 `[identity]` 块（live 状态、按 ts 倒序、上限 N 条）。
 *   字符上限保护：单条 content ≤ 240 字、整块 ≤ 1200 字。
 */

/**
 * Identity 的可枚举范畴标签。仅供模型自选 + 测试断言 / TUI 分组使用，
 * 不参与语义匹配。新增类目先在此扩枚举。
 */
export const IdentityKind = {
    /** 用户主动表达的偏好（语言、风格、详略度等）。 */
    Preference: "preference",
    /** Agent 对自身能力 / 边界的自述。 */
    SelfModel: "self-model",
    /** 当前长期目标 / 项目主线。 */
    Goal: "goal",
    /** 长期硬性约束（绝不要做 X / 必须做 Y）。 */
    Constraint: "constraint",
    /** 其它未分类。仅用于兜底，模型应优先归到上面四类。 */
    Other: "other",
} as const;

export type IdentityKind = (typeof IdentityKind)[keyof typeof IdentityKind];

/**
 * 模型同轮输出的一条 identity append 候选。运行时仅校验
 * { kind ∈ enum, content 非空且 ≤ 240 字 }，绝不解析文本含义。
 */
export interface IdentityAppendCandidate {
    kind: IdentityKind;
    /** 一条自述，建议 < 240 字（运行时截断）。 */
    content: string;
    /** 模型自评 0~1。缺省 1.0；超出会被截断到 [0,1]。 */
    confidence?: number;
}

/**
 * `memory_events.content` 中 `type='identity-append'` 行的 JSON 形状。
 */
export interface IdentityEventContent {
    kind: IdentityKind;
    content: string;
    confidence: number;
    /** Revert 时回写的元数据；live 状态行不带此字段。 */
    revertedAt?: number;
    /** 触发本次 append 的 turn requestId（审计用）。 */
    sourceRequestId?: string;
}

/** Identity append 解析器返回值。 */
export interface IdentityAppendParseResult {
    candidates: IdentityAppendCandidate[];
    /** 被丢弃的条目（非法 kind / 空 content / 超 maxAppends）。 */
    dropped: number;
    /** 去除 identity 块后的剩余文本。 */
    text: string;
}

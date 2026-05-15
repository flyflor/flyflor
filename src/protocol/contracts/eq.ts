/**
 * EQ-01 slice A — 情绪状态协议（最小骨架）。
 *
 * 设计要点（严格遵守 docs/boundaries.md 红线；历史背景见 docs/old-docs/eq.module.md）：
 * - **EqLabel 是封闭枚举**。runtime 严禁基于消息文本派生 label（零字符匹配红线）。
 *   label 只能由模型在 `MemoryAction.eq` 结构化字段中显式给出。
 * - 三个轴 valence（-1..1）/ arousal（0..1）/ dominance（0..1）走 PAD 模型常用范围。
 * - 衰减只用资源指标（now - updatedAt 的 valence 指数衰减），不读 label。
 * - 与 `MemoryActionAffect` 的关系：Affect 只用于 memory candidate 权重；EQ 是
 *   独立的短期状态轨道，互不污染。
 * - EQ 只允许影响语气、暖度和节奏，不得用于路由、工具选择、问答链深度或其他决策。
 */

export const EqLabel = {
    Neutral: "neutral",
    Joy: "joy",
    Anger: "anger",
    Sadness: "sadness",
    Fear: "fear",
    Surprise: "surprise",
} as const;

export type EqLabel = (typeof EqLabel)[keyof typeof EqLabel];

export interface EqState {
    userId: string;
    valence: number;
    arousal: number;
    dominance: number;
    label: EqLabel;
    confidence: number;
    /** 写入毫秒时间戳；衰减只看 now - updatedAt。 */
    updatedAt: number;
}

/** 模型同轮在 `MemoryAction.eq` 字段中给出的分类原始结构。 */
export interface EqClassification {
    valence: number;
    arousal: number;
    dominance: number;
    label: EqLabel;
    confidence: number;
}

/** 衰减默认半衰期（毫秒）。 valence 每 6 小时衰减 50%。 */
export const EQ_DEFAULT_HALFLIFE_MS = 6 * 60 * 60_000;

/**
 * EQ-02：语气提示枚举。
 * - 派生 100% 由 label + 数值阈值决定，零字符匹配；
 * - 仅供 prompt 文本使用，不得驱动路由、工具、ask cap 或其他决策；
 * - 模型仍然自由表达，directive 只指语气方向。
 */
export const EqDirective = {
    /** 高唤醒 + 负 valence（怒/悲/恐）→ 降速、简短、不堆问题。 */
    CalmDown: "calm-down",
    /** 高唤醒 + 正 valence（喜/惊喜）→ 短促匹配能量后回到正常节奏。 */
    MatchEnergy: "match-energy",
    /** 中性 / 已平复 → 维持当前基线，不要刻意调整。 */
    Steady: "steady",
} as const;

export type EqDirective = (typeof EqDirective)[keyof typeof EqDirective];

/**
 * 纯函数：从 EqState 派生语气提示。零字符匹配——只看 label + 数值阈值。
 * 阈值取保守值，避免 directive 频繁切换：
 * - confidence < 0.3：不下结论（返回 null，让模型按 [eq-context] 自由判断）；
 * - 已平复（|valence| < 0.15 且 arousal < 0.15）→ Steady；
 * - 高唤醒 + 负 valence + 标签 anger/sadness/fear → CalmDown；
 * - 高唤醒 + 正 valence + 标签 joy/surprise → MatchEnergy；
 * - 其他情况 → Steady。
 */
export function deriveEqDirective(state: EqState): EqDirective | null {
    if (state.confidence < 0.3) return null;
    const arousal = state.arousal;
    const valence = state.valence;
    if (Math.abs(valence) < 0.15 && arousal < 0.15) return EqDirective.Steady;
    const negativeLabel =
        state.label === EqLabel.Anger || state.label === EqLabel.Sadness || state.label === EqLabel.Fear;
    const positiveLabel = state.label === EqLabel.Joy || state.label === EqLabel.Surprise;
    if (arousal >= 0.4 && valence <= -0.2 && negativeLabel) return EqDirective.CalmDown;
    if (arousal >= 0.4 && valence >= 0.2 && positiveLabel) return EqDirective.MatchEnergy;
    return EqDirective.Steady;
}

/**
 * 纯函数：基于资源指标计算衰减后的 valence / arousal。
 * - valence 趋向 0（中性）；
 * - arousal 同样指数衰减；
 * - label / confidence 不衰减（label 由下一轮模型显式刷新）。
 * 零字符匹配红线：函数签名只接受数字 + 时间戳，不读任何文本。
 */
export function decayEq(state: EqState, nowMs: number, halflifeMs = EQ_DEFAULT_HALFLIFE_MS): EqState {
    const dt = Math.max(0, nowMs - state.updatedAt);
    const factor = Math.pow(0.5, dt / Math.max(1, halflifeMs));
    return {
        ...state,
        valence: roundTo3(state.valence * factor),
        arousal: roundTo3(state.arousal * factor),
        dominance: state.dominance,
        confidence: roundTo3(state.confidence * factor),
        updatedAt: state.updatedAt,
    };
}

const VALID_LABELS: ReadonlySet<string> = new Set(Object.values(EqLabel));

/**
 * 把模型同轮原始字段规范化为 EqClassification。任何字段非法 → 返回 null
 * 让上层丢弃；零字符匹配——不做"如果文本包含 happy 就当 joy"之类的猜测。
 */
export function normalizeEqClassification(raw: unknown): EqClassification | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" && VALID_LABELS.has(r.label) ? (r.label as EqLabel) : null;
    const valence = clampSigned(r.valence);
    const arousal = clamp01(r.arousal);
    const dominance = clamp01(r.dominance);
    const confidence = clamp01(r.confidence);
    if (label === null || valence === null || arousal === null || dominance === null || confidence === null) {
        return null;
    }
    return {
        valence,
        arousal,
        dominance,
        label,
        confidence,
    };
}

function clamp01(v: unknown): number | null {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return roundTo3(v);
}

function clampSigned(v: unknown): number | null {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < -1) return -1;
    if (v > 1) return 1;
    return roundTo3(v);
}

function roundTo3(v: number): number {
    return Math.round(v * 1000) / 1000;
}

/**
 * Dream 决策解析（README.md §12.2）。
 *
 * LLM 输出三类动作，由代码做 enum + JSON shape 校验，绝不做关键词/语义匹配。
 * 三类动作的写入路径见 dream.module.ts。
 */

export const DreamActionKind = {
    DriftRepair: "drift-repair",
    RecallReinforce: "recall-reinforce",
    ContradictionAudit: "contradiction-audit",
    Reconsolidation: "reconsolidation",
    Skip: "skip",
} as const;
export type DreamActionKind = (typeof DreamActionKind)[keyof typeof DreamActionKind];

export const DreamSkillStatus = {
    Active: "active",
    Deprecated: "deprecated",
} as const;
export type DreamSkillStatus = (typeof DreamSkillStatus)[keyof typeof DreamSkillStatus];

export interface DreamDriftRepairDecision {
    candidateId: string;
    action: typeof DreamActionKind.DriftRepair;
    /** 重写后摘要；空则不改 summary。 */
    newSummary?: string;
    /** 新 symbols 集合（小写、去重，≤16）。 */
    newSymbols?: string[];
    /** scope 注记，可附在 summary 末尾或独立字段。 */
    scopeNote?: string;
    /** 默认 active；若 LLM 判定该 skill 已过时整体废弃即 deprecated。 */
    newStatus?: DreamSkillStatus;
    /** confidence 调整乘子（0.0~1.0）。缺省 1.0。 */
    confidenceMultiplier?: number;
}

export interface DreamRecallReinforceDecision {
    candidateId: string;
    action: typeof DreamActionKind.RecallReinforce;
    /** importance 调整乘子（0.5~1.5）；超出区间会被截断。 */
    importanceMultiplier: number;
}

export interface DreamContradictionAuditDecision {
    candidateId: string;
    action: typeof DreamActionKind.ContradictionAudit;
    /** "left" / "right" / "both"：被判定为弱侧的节点；both = 双方都不强。 */
    weaker: "left" | "right" | "both";
    /** 弱侧 confidence 乘子（默认 0.7），代码会 clamp 到 [0.3, 1.0]。 */
    confidenceMultiplier?: number;
    /** 弱侧 contradictionCount 增量（默认 1）。 */
    contradictionDelta?: number;
    /** 是否在两节点之间建立 contradicts 关系边（默认 true）。 */
    relate?: boolean;
}

export interface DreamReconsolidationDecision {
    candidateId: string;
    action: typeof DreamActionKind.Reconsolidation;
    /** "left" | "right"：保留方；"merge" = 在 left 上写合并摘要并把 right 标记为 supersededBy=left。 */
    winner: "left" | "right" | "merge";
    /** 合并/重写后摘要；空则不改 summary。 */
    mergedSummary?: string;
    /** 合并后的 symbols（小写、去重、≤16）。 */
    mergedSymbols?: string[];
    /** scope 注记或保留侧的来源标签。 */
    scopeNote?: string;
}

export interface DreamSkipDecision {
    candidateId: string;
    action: typeof DreamActionKind.Skip;
}

export type DreamDecision =
    | DreamDriftRepairDecision
    | DreamRecallReinforceDecision
    | DreamContradictionAuditDecision
    | DreamReconsolidationDecision
    | DreamSkipDecision;

/** LLM 返回原始字符串 → 校验过的决策数组；坏 JSON / 坏条目跳过，避免 dream 维护链断开。 */
export function parseDreamDecisions(raw: string, maxSummaryChars = 600): DreamDecision[] {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    } catch {
        return [];
    }
    if (!isRecord(parsed)) return [];
    const list = (parsed as { decisions?: unknown }).decisions;
    if (!Array.isArray(list)) return [];
    const out: DreamDecision[] = [];
    for (const entry of list) {
        if (!isRecord(entry)) continue;
        const candidateId = typeof entry.candidateId === "string" ? entry.candidateId.trim() : "";
        if (candidateId.length === 0) continue;
        const action = entry.action;
        switch (action) {
            case DreamActionKind.DriftRepair: {
                const dec: DreamDriftRepairDecision = { candidateId, action: DreamActionKind.DriftRepair };
                if (typeof entry.newSummary === "string" && entry.newSummary.trim().length > 0) {
                    dec.newSummary = entry.newSummary.trim().slice(0, maxSummaryChars);
                }
                if (Array.isArray(entry.newSymbols)) {
                    dec.newSymbols = sanitizeSymbols(entry.newSymbols);
                }
                if (typeof entry.scopeNote === "string" && entry.scopeNote.trim().length > 0) {
                    dec.scopeNote = entry.scopeNote.trim().slice(0, 200);
                }
                if (entry.newStatus === DreamSkillStatus.Active || entry.newStatus === DreamSkillStatus.Deprecated) {
                    dec.newStatus = entry.newStatus;
                }
                if (typeof entry.confidenceMultiplier === "number" && Number.isFinite(entry.confidenceMultiplier)) {
                    dec.confidenceMultiplier = clamp(entry.confidenceMultiplier, 0, 1);
                }
                out.push(dec);
                break;
            }
            case DreamActionKind.RecallReinforce: {
                const mult =
                    typeof entry.importanceMultiplier === "number" && Number.isFinite(entry.importanceMultiplier)
                        ? clamp(entry.importanceMultiplier, 0.5, 1.5)
                        : 1.0;
                out.push({ candidateId, action: DreamActionKind.RecallReinforce, importanceMultiplier: mult });
                break;
            }
            case DreamActionKind.ContradictionAudit: {
                const weaker = entry.weaker;
                if (weaker !== "left" && weaker !== "right" && weaker !== "both") break;
                const dec: DreamContradictionAuditDecision = {
                    candidateId,
                    action: DreamActionKind.ContradictionAudit,
                    weaker,
                };
                if (typeof entry.confidenceMultiplier === "number" && Number.isFinite(entry.confidenceMultiplier)) {
                    dec.confidenceMultiplier = clamp(entry.confidenceMultiplier, 0.3, 1.0);
                }
                if (typeof entry.contradictionDelta === "number" && Number.isFinite(entry.contradictionDelta)) {
                    dec.contradictionDelta = Math.max(0, Math.min(5, Math.floor(entry.contradictionDelta)));
                }
                if (typeof entry.relate === "boolean") dec.relate = entry.relate;
                out.push(dec);
                break;
            }
            case DreamActionKind.Skip:
                out.push({ candidateId, action: DreamActionKind.Skip });
                break;
            case DreamActionKind.Reconsolidation: {
                const winner = entry.winner;
                if (winner !== "left" && winner !== "right" && winner !== "merge") break;
                const dec: DreamReconsolidationDecision = {
                    candidateId,
                    action: DreamActionKind.Reconsolidation,
                    winner,
                };
                if (typeof entry.mergedSummary === "string" && entry.mergedSummary.trim().length > 0) {
                    dec.mergedSummary = entry.mergedSummary.trim().slice(0, maxSummaryChars);
                }
                if (Array.isArray(entry.mergedSymbols)) {
                    dec.mergedSymbols = sanitizeSymbols(entry.mergedSymbols);
                }
                if (typeof entry.scopeNote === "string" && entry.scopeNote.trim().length > 0) {
                    dec.scopeNote = entry.scopeNote.trim().slice(0, 200);
                }
                out.push(dec);
                break;
            }
            default:
                continue;
        }
    }
    return out;
}

function sanitizeSymbols(input: unknown[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of input) {
        if (typeof v !== "string") continue;
        const s = v.trim().toLowerCase();
        if (s.length === 0 || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= 16) break;
    }
    return out;
}

function clamp(value: number, lo: number, hi: number): number {
    if (Number.isNaN(value)) return lo;
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

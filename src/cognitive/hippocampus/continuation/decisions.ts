/**
 * Continuation 决策块解析器（LF-R4 fork/fresh hint）。
 *
 * 模型同轮可在自由文本中嵌入一个 `<flyflor_continuation_decisions>{json[]}</flyflor_continuation_decisions>` 块，
 * 表达对当前 `[continuation-hint]` 中候选 continuation 的处理意图：
 *
 * ```
 * <flyflor_continuation_decisions>
 * [{"continuationId":"continuation-xxx","kind":"fresh"}, {"continuationId":"continuation-yyy","kind":"resume"}]
 * </flyflor_continuation_decisions>
 * ```
 *
 * runtime 严禁通过 text.includes / 关键词判断 continuation 关联（业务语义零字符匹配红线）；
 * 决策必须由模型显式输出本块，且 continuationId 必须命中当前活跃 continuation。
 */

import {
    ContinuationDecisionKind,
    type AgentAsk,
    type ContinuationDecision,
} from "../../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../../protocol/index.ts";
import { agentAskParser } from "../ask/index.ts";

const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(ContinuationDecisionKind));

export interface ParsedContinuationDecisions {
    decisions: ContinuationDecision[];
    forkMerges: ContextForkMergeDecision[];
    /** 剥离决策块后剩余的文本。 */
    text: string;
    /** 兼容旧事件字段；严格模式下始终为 0。 */
    dropped: number;
}

export const ContextForkMergeKind = {
    ConflictAsk: "conflict-ask",
    Merged: "merged",
} as const;

export type ContextForkMergeKind = (typeof ContextForkMergeKind)[keyof typeof ContextForkMergeKind];

export interface ContextForkMergeConflict {
    id: string;
    summary: string;
    options: string[];
    relatedIds?: string[];
}

export interface ContextForkClosureEvidence {
    kind: string;
    weight: number;
    sourceId: string;
    note: string;
}

export interface ContextForkMergeDecision {
    conflictAsk?: AgentAsk;
    conflicts: ContextForkMergeConflict[];
    forkId: string;
    kind: ContextForkMergeKind;
    mergedSummary?: string;
    closureEvidence?: ContextForkClosureEvidence[];
}

/**
 * Continuation decision structured block parser.
 *
 * Runtime production paths should hold this parser so fork/fresh decisions are
 * owned by the continuation module instead of scattered as top-level business logic.
 */
export class ContinuationDecisionParser {
    public parse(rawText: string, maxDecisions = 8): ParsedContinuationDecisions {
        const seen = new Set<string>();
        const decisions: ContinuationDecision[] = [];
        const forkMerges: ContextForkMergeDecision[] = [];
        let dropped = 0;
        // tag 与剥离规则由 protocol registry 统一管理；这里仅消费 {continuationId, kind} 结构字段。
        const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.ContinuationDecisions);
        for (const block of extracted.blocks) {
            let parsed: ContinuationDecision[];
            try {
                const bundle = this.readDecisionBundle(block.content);
                parsed = bundle.decisions;
                forkMerges.push(...bundle.forkMerges);
            } catch {
                dropped += 1;
                continue;
            }
            for (const item of parsed) {
                if (decisions.length >= maxDecisions) {
                    dropped += 1;
                    continue;
                }
                if (seen.has(item.continuationId)) {
                    dropped += 1;
                    continue;
                }
                seen.add(item.continuationId);
                decisions.push(item);
            }
        }
        return { decisions, forkMerges, text: extracted.text, dropped };
    }

    private readDecisionBundle(rawJson: string): {
        decisions: ContinuationDecision[];
        forkMerges: ContextForkMergeDecision[];
    } {
        const payload = parseStructuredJson(rawJson);
        const decisionPayload = this.readArrayPayload(payload, "decisions");
        const out: ContinuationDecision[] = [];
        for (const item of decisionPayload) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const continuationId = typeof record.continuationId === "string" ? record.continuationId.trim() : "";
            const kind = typeof record.kind === "string" ? record.kind.trim() : "";
            if (!continuationId || !VALID_KINDS.has(kind)) continue;
            out.push({ continuationId, kind: kind as ContinuationDecision["kind"] });
        }
        return {
            decisions: out,
            forkMerges: this.readForkMerges(payload),
        };
    }

    private readForkMerges(payload: unknown): ContextForkMergeDecision[] {
        const items = this.readOptionalArrayPayload(payload, "forkMerges");
        if (!items) {
            return [];
        }
        return items.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const forkId = typeof record.forkId === "string" ? record.forkId.trim().slice(0, 120) : "";
            const kind = typeof record.kind === "string" ? record.kind.trim() : "";
            if (!forkId || !this.isForkMergeKind(kind)) return [];
            const conflicts = this.normalizeConflicts(record.conflicts);
            const conflictAsk = record.conflictAsk ? agentAskParser.normalizePayload(record.conflictAsk) : undefined;
            const mergedSummary =
                typeof record.mergedSummary === "string" && record.mergedSummary.trim()
                    ? record.mergedSummary.trim().slice(0, 1200)
                    : undefined;
            const closureEvidence = this.normalizeClosureEvidence(record.closureEvidence);
            if (kind === ContextForkMergeKind.ConflictAsk && (!conflictAsk || conflicts.length === 0)) {
                return [];
            }
            if (kind === ContextForkMergeKind.Merged && (!mergedSummary || closureEvidence.length === 0)) {
                return [];
            }
            const decision: ContextForkMergeDecision = {
                conflicts,
                forkId,
                kind,
            };
            if (conflictAsk) decision.conflictAsk = conflictAsk;
            if (mergedSummary) decision.mergedSummary = mergedSummary;
            if (closureEvidence.length > 0) decision.closureEvidence = closureEvidence;
            return [decision];
        });
    }

    private readArrayPayload(payload: unknown, arrayKey: string): unknown[] {
        if (Array.isArray(payload)) return payload;
        if (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>)[arrayKey])) {
            return (payload as Record<string, unknown>)[arrayKey] as unknown[];
        }
        if (
            arrayKey === "decisions" &&
            payload &&
            typeof payload === "object" &&
            Array.isArray((payload as Record<string, unknown>).forkMerges)
        ) {
            return [];
        }
        throw new Error(`flyflor_continuation_decisions must be an array or object with ${arrayKey}[].`);
    }

    private readOptionalArrayPayload(payload: unknown, arrayKey: string): unknown[] | undefined {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return undefined;
        }
        const value = (payload as Record<string, unknown>)[arrayKey];
        return Array.isArray(value) ? value : undefined;
    }

    private normalizeConflicts(value: unknown): ContextForkMergeConflict[] {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 8).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id.trim().slice(0, 120) : "";
            const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 800) : "";
            const options = this.normalizeStringArray(record.options, 8, 240);
            if (!id || !summary || options.length === 0) return [];
            const conflict: ContextForkMergeConflict = { id, summary, options };
            const relatedIds = this.normalizeStringArray(record.relatedIds, 16, 160);
            if (relatedIds.length > 0) conflict.relatedIds = relatedIds;
            return [conflict];
        });
    }

    private normalizeClosureEvidence(value: unknown): ContextForkClosureEvidence[] {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 12).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const record = item as Record<string, unknown>;
            const kind = typeof record.kind === "string" ? record.kind.trim().slice(0, 120) : "";
            const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim().slice(0, 160) : "";
            const note = typeof record.note === "string" ? record.note.trim().slice(0, 500) : "";
            const weight = typeof record.weight === "number" && Number.isFinite(record.weight) ? record.weight : undefined;
            if (!kind || !sourceId || !note || weight === undefined) return [];
            return [{ kind, sourceId, note, weight: Math.max(0, Math.min(1, weight)) }];
        });
    }

    private normalizeStringArray(value: unknown, limit: number, itemLimit: number): string[] {
        if (!Array.isArray(value)) return [];
        const out: string[] = [];
        for (const item of value) {
            if (typeof item !== "string") continue;
            const trimmed = item.trim();
            if (!trimmed) continue;
            out.push(trimmed.slice(0, itemLimit));
            if (out.length >= limit) break;
        }
        return out;
    }

    private isForkMergeKind(value: string): value is ContextForkMergeKind {
        return value === ContextForkMergeKind.ConflictAsk || value === ContextForkMergeKind.Merged;
    }
}

export const continuationDecisionParser = new ContinuationDecisionParser();

export function parseContinuationDecisions(rawText: string, maxDecisions = 8): ParsedContinuationDecisions {
    return continuationDecisionParser.parse(rawText, maxDecisions);
}

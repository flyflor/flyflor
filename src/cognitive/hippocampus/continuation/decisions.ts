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

import { ContinuationDecisionKind, type ContinuationDecision } from "../../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../../protocol/index.ts";

const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(ContinuationDecisionKind));

export interface ParsedContinuationDecisions {
    decisions: ContinuationDecision[];
    /** 剥离决策块后剩余的文本。 */
    text: string;
    /** 兼容旧事件字段；严格模式下始终为 0。 */
    dropped: number;
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
        let dropped = 0;
        // tag 与剥离规则由 protocol registry 统一管理；这里仅消费 {continuationId, kind} 结构字段。
        const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.ContinuationDecisions);
        for (const block of extracted.blocks) {
            let parsed: ContinuationDecision[];
            try {
                parsed = this.readDecisions(block.content);
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
        return { decisions, text: extracted.text, dropped };
    }

    private readDecisions(rawJson: string): ContinuationDecision[] {
        const payload = parseStructuredJson(rawJson);
        if (!Array.isArray(payload)) {
            throw new Error("flyflor_continuation_decisions must be a JSON array.");
        }
        const out: ContinuationDecision[] = [];
        for (const item of payload) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const continuationId = typeof record.continuationId === "string" ? record.continuationId.trim() : "";
            const kind = typeof record.kind === "string" ? record.kind.trim() : "";
            if (!continuationId || !VALID_KINDS.has(kind)) continue;
            out.push({ continuationId, kind: kind as ContinuationDecision["kind"] });
        }
        return out;
    }
}

export const continuationDecisionParser = new ContinuationDecisionParser();

export function parseContinuationDecisions(rawText: string, maxDecisions = 8): ParsedContinuationDecisions {
    return continuationDecisionParser.parse(rawText, maxDecisions);
}

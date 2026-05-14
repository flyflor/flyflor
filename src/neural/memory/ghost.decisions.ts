/**
 * Ghost 决策块解析器（LF-R4 fork/fresh hint）。
 *
 * 模型同轮可在自由文本中嵌入一个 `<flyflor_ghost_decisions>{json[]}</flyflor_ghost_decisions>` 块，
 * 表达对当前 `[ghost-hint]` 中候选 ghost 的处理意图：
 *
 * ```
 * <flyflor_ghost_decisions>
 * [{"ghostId":"ghost-xxx","kind":"fresh"}, {"ghostId":"ghost-yyy","kind":"resume"}]
 * </flyflor_ghost_decisions>
 * ```
 *
 * runtime 严禁通过 text.includes / 关键词判断 ghost 关联（业务语义零字符匹配红线）；
 * 决策必须由模型显式输出本块，且 ghostId 必须命中当前活跃 ghost。
 */

import { GhostDecisionKind, type GhostDecision } from "../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../protocol/index.ts";

const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(GhostDecisionKind));

export interface ParsedGhostDecisions {
    decisions: GhostDecision[];
    /** 剥离决策块后剩余的文本。 */
    text: string;
    /** 兼容旧事件字段；严格模式下始终为 0。 */
    dropped: number;
}

export function parseGhostDecisions(rawText: string, maxDecisions = 8): ParsedGhostDecisions {
    const seen = new Set<string>();
    const decisions: GhostDecision[] = [];
    let dropped = 0;
    // tag 与剥离规则由 protocol registry 统一管理；这里仅消费 {ghostId, kind} 结构字段。
    const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.GhostDecisions);
    for (const block of extracted.blocks) {
        let parsed: GhostDecision[];
        try {
            parsed = readDecisions(block.content);
        } catch {
            dropped += 1;
            continue;
        }
        for (const item of parsed) {
            if (decisions.length >= maxDecisions) {
                dropped += 1;
                continue;
            }
            if (seen.has(item.ghostId)) {
                dropped += 1;
                continue;
            }
            seen.add(item.ghostId);
            decisions.push(item);
        }
    }
    return { decisions, text: extracted.text, dropped };
}

function readDecisions(rawJson: string): GhostDecision[] {
    const payload = parseStructuredJson(rawJson);
    if (!Array.isArray(payload)) {
        throw new Error("flyflor_ghost_decisions must be a JSON array.");
    }
    const out: GhostDecision[] = [];
    for (const item of payload) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const ghostId = typeof record.ghostId === "string" ? record.ghostId.trim() : "";
        const kind = typeof record.kind === "string" ? record.kind.trim() : "";
        if (!ghostId || !VALID_KINDS.has(kind)) continue;
        out.push({ ghostId, kind: kind as GhostDecision["kind"] });
    }
    return out;
}

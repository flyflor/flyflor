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

const DECISION_BLOCK = /<flyflor_ghost_decisions>\s*([\s\S]*?)\s*<\/flyflor_ghost_decisions>/g;
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
    const text = rawText.replace(DECISION_BLOCK, (_block, rawJson: string) => {
        const parsed = readDecisions(rawJson);
        for (const item of parsed) {
            if (decisions.length >= maxDecisions) {
                throw new Error(`flyflor_ghost_decisions exceeds max decisions: ${maxDecisions}.`);
            }
            if (seen.has(item.ghostId)) {
                throw new Error(`flyflor_ghost_decisions contains duplicate ghostId: ${item.ghostId}`);
            }
            seen.add(item.ghostId);
            decisions.push(item);
        }
        return "";
    });
    return { decisions, text: text.trim(), dropped };
}

function readDecisions(rawJson: string): GhostDecision[] {
    const payload = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(payload)) {
        throw new Error("flyflor_ghost_decisions must be a JSON array.");
    }
    const out: GhostDecision[] = [];
    for (const [index, item] of payload.entries()) {
        if (!item || typeof item !== "object") {
            throw new Error(`flyflor_ghost_decisions item ${index + 1} must be an object.`);
        }
        const record = item as Record<string, unknown>;
        const ghostId = typeof record.ghostId === "string" ? record.ghostId.trim() : "";
        const kind = typeof record.kind === "string" ? record.kind.trim() : "";
        if (!ghostId || !VALID_KINDS.has(kind)) {
            throw new Error(`flyflor_ghost_decisions item ${index + 1} is invalid.`);
        }
        out.push({ ghostId, kind: kind as GhostDecision["kind"] });
    }
    return out;
}

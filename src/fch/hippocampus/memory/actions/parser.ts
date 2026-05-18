import { MarkdownMemoryFile, MemoryActionTarget, MemoryKind } from "../../../../protocol/contracts/index.ts";
import { normalizeEqClassification, type EqClassification } from "../../../../protocol/contracts/eq.ts";
import { extractStructuredBlocks, parseStructuredJson, structuredBlock, StructuredBlockProtocol } from "../../../../protocol/index.ts";

export interface MemoryAction {
    action: "add";
    target: MemoryActionTarget;
    content: string;
    affect?: MemoryActionAffect;
    kind?: MemoryKind;
    confidence?: number;
    reason?: string;
    signals?: MemoryActionSignals;
    /**
     * LF-R2 Codename：模型同轮结构化输出的工作目录锚点。runtime 不做任何
     * `@xxx` 字符串匹配（零字符匹配红线），代号只能由模型显式给出。
     */
    codename?: MemoryActionCodename;
    /**
     * EQ-01 slice A：模型同轮结构化输出的情绪分类（PAD 三轴 + 封闭 label 枚举）。
     * runtime 严禁基于消息文本派生 label / valence；本字段为零字符匹配红线下
     * 唯一合法来源。缺失或非法时丢弃，不做猜测。
     */
    eq?: EqClassification;
}

export interface MemoryActionCodename {
    name: string;
    workingDir?: string;
    description?: string;
}

export interface MemoryActionAffect {
    arousal?: number;
    dominance?: number;
    valence?: number;
}

export interface MemoryActionSignals {
    actionability?: number;
    certainty?: number;
    durability?: number;
    recurrence?: number;
    relevance?: number;
    sourceDiversity?: number;
    validationCount?: number;
    /** 显式项目固化意图（0..1）。≥ 0.7 直接触发 project-init（见 src/fch/hippocampus/project）。 */
    projectIntent?: number;
    /** 显式事件记录意图（0..1）。≥ 0.7 触发 event-record。 */
    eventIntent?: number;
    /** 显式技能固化意图（0..1）。≥ 0.7 直接把当前 pending skill offer 升格成 SKILL.md。 */
    skillPromotionIntent?: number;
}

export interface ParsedMemoryActions {
    actions: MemoryAction[];
    text: string;
}

const MEMORY_ACTION_BLOCK = structuredBlock(StructuredBlockProtocol.MemoryActions);

export function parseMemoryActions(rawText: string, maxActions: number): ParsedMemoryActions {
    const actions: MemoryAction[] = [];
    // 统一从 protocol registry 剥离块，避免 memory action 与其它内部协议各自维护 tag。
    const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.MemoryActions);
    for (const block of extracted.blocks) {
        actions.push(...readActions(block.content));
    }

    if (actions.length > maxActions) {
        throw new Error(`flyflor_memory_actions returned ${actions.length} items, max is ${maxActions}.`);
    }
    for (const [index, action] of actions.entries()) {
        assertSafeAction(action, index);
    }
    return { actions, text: extracted.text };
}

export function targetFileForMemoryAction(action: MemoryAction): MarkdownMemoryFile {
    if (action.target === MemoryActionTarget.User) {
        return MarkdownMemoryFile.User;
    }
    if (action.target === MemoryActionTarget.Soul) {
        return MarkdownMemoryFile.Soul;
    }
    if (action.target === MemoryActionTarget.Self) {
        return MarkdownMemoryFile.Self;
    }
    return MarkdownMemoryFile.Memory;
}

export function kindForMemoryAction(action: MemoryAction): MemoryKind {
    if (action.kind && Object.values(MemoryKind).includes(action.kind)) {
        return action.kind;
    }
    if (action.target === MemoryActionTarget.User) {
        return MemoryKind.Profile;
    }
    if (action.target === MemoryActionTarget.Soul) {
        return MemoryKind.Rule;
    }
    return MemoryKind.Fact;
}

function readActions(rawJson: string): MemoryAction[] {
    const payload = parseStructuredJson(rawJson);
    const items = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.actions) ? payload.actions : null;
    if (!items) {
        throw new Error("flyflor_memory_actions must be a JSON array or an object with actions[].");
    }
    return items.map((item, index) => {
        if (!isMemoryAction(item)) {
            throw new Error(`flyflor_memory_actions item ${index + 1} is invalid.`);
        }
        return normalizeAction(item);
    });
}

function isMemoryAction(value: unknown): value is MemoryAction {
    if (!isRecord(value)) {
        return false;
    }
    return (
        value.action === "add" &&
        (value.target === MemoryActionTarget.Memory ||
            value.target === MemoryActionTarget.Self ||
            value.target === MemoryActionTarget.Soul ||
            value.target === MemoryActionTarget.User) &&
        typeof value.content === "string"
    );
}

function assertSafeAction(action: MemoryAction, index: number): void {
    if (action.content.length < 2 || action.content.length > 500) {
        throw new Error(`flyflor_memory_actions item ${index + 1} has invalid content length.`);
    }
    if (action.content.includes(MEMORY_ACTION_BLOCK.open) || action.content.includes(MEMORY_ACTION_BLOCK.close)) {
        throw new Error(`flyflor_memory_actions item ${index + 1} contains nested action tags.`);
    }
}

function normalizeAction(action: MemoryAction): MemoryAction {
    return {
        action: "add",
        target: action.target,
        content: action.content.replace(/\s+/g, " ").trim(),
        affect: normalizeAffect(action.affect),
        kind: isMemoryKind(action.kind) ? action.kind : undefined,
        confidence: clamp01(action.confidence ?? 0.9),
        reason: typeof action.reason === "string" ? action.reason.replace(/\s+/g, " ").trim().slice(0, 240) : undefined,
        signals: normalizeSignals(action.signals),
        codename: normalizeCodename(action.codename),
        eq: normalizeEqClassification(action.eq) ?? undefined,
    };
}

function normalizeCodename(value: unknown): MemoryActionCodename | undefined {
    if (!isRecord(value)) return undefined;
    const name = typeof value.name === "string" ? value.name.replace(/\s+/g, "").trim() : "";
    if (name.length === 0 || name.length > 64) return undefined;
    const workingDir =
        typeof value.workingDir === "string" && value.workingDir.trim().length > 0
            ? value.workingDir.trim().slice(0, 500)
            : undefined;
    const description =
        typeof value.description === "string" && value.description.trim().length > 0
            ? value.description.replace(/\s+/g, " ").trim().slice(0, 240)
            : undefined;
    return { name, workingDir, description };
}

function normalizeAffect(value: unknown): MemoryActionAffect {
    if (!isRecord(value)) {
        return {};
    }
    return {
        arousal: clamp01(numberValue(value.arousal)),
        dominance: clamp01(numberValue(value.dominance)),
        valence: clampSigned(numberValue(value.valence)),
    };
}

function normalizeSignals(value: unknown): MemoryActionSignals {
    if (!isRecord(value)) {
        return {};
    }
    return {
        actionability: clamp01(numberValue(value.actionability)),
        certainty: clamp01(numberValue(value.certainty)),
        durability: clamp01(numberValue(value.durability)),
        recurrence: clamp01(numberValue(value.recurrence)),
        relevance: clamp01(numberValue(value.relevance)),
        projectIntent: clamp01(numberValue(value.projectIntent)),
        eventIntent: clamp01(numberValue(value.eventIntent)),
        skillPromotionIntent: clamp01(numberValue(value.skillPromotionIntent)),
        sourceDiversity: clamp01(numberValue(value.sourceDiversity)),
        validationCount: clamp01(numberValue(value.validationCount)),
    };
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Math.max(-1, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isMemoryKind(value: unknown): value is MemoryKind {
    return typeof value === "string" && Object.values(MemoryKind).includes(value as MemoryKind);
}

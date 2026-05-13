/**
 * Ask 块解析器（LF-R3）。
 *
 * 模型同轮可在自由文本中嵌入一个 `<flyflor_agent_ask>{json}</flyflor_agent_ask>` 块
 * 来表达 `kind='ask'`。runtime 严禁通过 text.includes / 正则 / 关键词判断是否要 ask
 * （业务语义零字符匹配红线）；ask 必须由模型显式输出本块。
 *
 * 与 `<flyflor_memory_actions>` 解析互不干扰：解析顺序由调用方决定，本模块只剥离自身块。
 *
 * 互斥规则：reply 与 ask 同轮二选一，runtime 在 reply 流水线判断
 * `parsed.ask !== undefined` → 切换到 ask 渲染分支。
 */

import type { AgentAsk, AgentAskChoice, AgentAskQuestion, AskReason } from "../../protocol/contracts/index.ts";
import { AskReason as AskReasonEnum } from "../../protocol/contracts/index.ts";

const ASK_BLOCK = /<flyflor_agent_ask>\s*([\s\S]*?)\s*<\/flyflor_agent_ask>/g;

export interface ParsedAgentAsk {
    /** 同轮第一段合法 ask 块；多余的 ask 块会被丢弃且记入 `dropped`。 */
    ask?: AgentAsk;
    /** 文本中剥离 ask 块后剩下的 visible reply 文本（仍是 raw model output）。 */
    text: string;
    /** 解析过程被丢弃的非法 / 多余块数量，便于调用方做事件埋点。 */
    dropped: number;
}

const VALID_REASONS: ReadonlySet<string> = new Set(Object.values(AskReasonEnum));

export function parseAgentAsk(rawText: string): ParsedAgentAsk {
    let firstAsk: AgentAsk | undefined;
    let dropped = 0;
    const text = rawText.replace(ASK_BLOCK, (_block, rawJson: string) => {
        const candidate = readAsk(rawJson);
        if (!candidate) {
            dropped += 1;
            return "";
        }
        if (firstAsk) {
            dropped += 1;
            return "";
        }
        firstAsk = candidate;
        return "";
    });
    return { ask: firstAsk, text: text.trim(), dropped };
}

function readAsk(rawJson: string): AgentAsk | undefined {
    let payload: unknown;
    try {
        payload = JSON.parse(rawJson);
    } catch {
        return undefined;
    }
    if (!payload || typeof payload !== "object") return undefined;
    const obj = payload as Record<string, unknown>;
    const reason = normalizeReason(obj.reason);
    if (!reason) return undefined;
    const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
    if (!prompt) return undefined;
    const choices = normalizeChoices(obj.choices);
    const questions = normalizeQuestions(obj.questions);
    const freeform = typeof obj.freeform === "boolean" ? obj.freeform : true;
    const relatedIds = normalizeStringArray(obj.relatedIds);
    const rationale = typeof obj.rationale === "string" ? obj.rationale.trim().slice(0, 500) : undefined;
    const ghostHint = normalizeGhostHint(obj.ghostHint);
    const ask: AgentAsk = {
        reason,
        prompt: prompt.slice(0, 2000),
        freeform,
    };
    if (choices && choices.length > 0) ask.choices = choices;
    if (questions && questions.length > 0) ask.questions = questions;
    if (relatedIds && relatedIds.length > 0) ask.relatedIds = relatedIds;
    if (rationale) ask.rationale = rationale;
    if (ghostHint) ask.ghostHint = ghostHint;
    return ask;
}

function normalizeGhostHint(value: unknown): { title?: string; contextHint?: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const obj = value as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 120) : undefined;
    const contextHint = typeof obj.contextHint === "string" ? obj.contextHint.trim().slice(0, 500) : undefined;
    if (!title && !contextHint) return undefined;
    const out: { title?: string; contextHint?: string } = {};
    if (title) out.title = title;
    if (contextHint) out.contextHint = contextHint;
    return out;
}

function normalizeReason(value: unknown): AskReason | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!VALID_REASONS.has(trimmed)) return undefined;
    return trimmed as AskReason;
}

function normalizeChoices(value: unknown): AgentAskChoice[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: AgentAskChoice[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const obj = raw as Record<string, unknown>;
        const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 200) : "";
        if (!label) continue;
        const choice: AgentAskChoice = { label };
        if (typeof obj.value === "string" && obj.value.trim()) choice.value = obj.value.trim().slice(0, 200);
        if (typeof obj.description === "string" && obj.description.trim()) {
            choice.description = obj.description.trim().slice(0, 500);
        }
        out.push(choice);
        if (out.length >= 12) break;
    }
    return out;
}

function normalizeQuestions(value: unknown): AgentAskQuestion[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: AgentAskQuestion[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const obj = raw as Record<string, unknown>;
        const prompt = typeof obj.prompt === "string" ? obj.prompt.trim().slice(0, 500) : "";
        if (!prompt) continue;
        const question: AgentAskQuestion = { prompt };
        if (typeof obj.id === "string" && obj.id.trim()) question.id = obj.id.trim().slice(0, 100);
        const choices = normalizeChoices(obj.choices);
        if (choices && choices.length > 0) question.choices = choices;
        if (typeof obj.freeform === "boolean") question.freeform = obj.freeform;
        const relatedIds = normalizeStringArray(obj.relatedIds);
        if (relatedIds && relatedIds.length > 0) question.relatedIds = relatedIds;
        if (typeof obj.rationale === "string" && obj.rationale.trim()) {
            question.rationale = obj.rationale.trim().slice(0, 500);
        }
        out.push(question);
        if (out.length >= 8) break;
    }
    return out;
}

function normalizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string") continue;
        const trimmed = raw.trim();
        if (trimmed) out.push(trimmed.slice(0, 200));
        if (out.length >= 16) break;
    }
    return out;
}

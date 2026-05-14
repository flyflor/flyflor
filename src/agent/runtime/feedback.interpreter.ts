import { ModelRole, type ModelClient } from "../../protocol/contracts/index.ts";
import { renderFeedbackClassifyPrompt } from "../prompts/index.ts";

/**
 * Feedback Interpreter（反馈分类器）：将用户上一回合给出的反馈，归入
 * 四类语义路径之一，驱动后续记忆写入策略。严禁字符串/正则/关键词匹配 —
 * 全部由 LLM 结构化 JSON 输出决定。
 *
 *   A LocalCorrection  → 单点纠错（写 episode + 标注 correction）
 *   B Preference       → 偏好声明（升格 user profile fact）
 *   C GlobalStrategy   → 全局策略调整（写 SELF.md 行为约束）
 *   D Confirmation     → 验证确认（强化已有 skill/memory_node）
 *   None               → 不属于反馈（普通继续对话）
 */
export const FeedbackCategory = {
    LocalCorrection: "local-correction",
    Preference: "preference",
    GlobalStrategy: "global-strategy",
    Confirmation: "confirmation",
    None: "none",
} as const;
export type FeedbackCategory = (typeof FeedbackCategory)[keyof typeof FeedbackCategory];

export interface FeedbackClassification {
    category: FeedbackCategory;
    confidence: number;
    rationale: string;
    extractedFact?: string;
}

export interface FeedbackInterpreterInput {
    previousAssistantText: string;
    currentUserText: string;
}

export async function classifyFeedback(
    model: ModelClient,
    input: FeedbackInterpreterInput,
): Promise<FeedbackClassification> {
    const prompt = renderFeedbackClassifyPrompt({
        previousAssistantText: input.previousAssistantText,
        currentUserText: input.currentUserText,
    });
    const raw = await model.generate([{ role: ModelRole.User, content: prompt }]);
    return parseClassification(raw);
}

export function parseClassification(raw: string): FeedbackClassification {
    const json = extractJsonObject(raw);
    if (!json) {
        throw new Error("Feedback classifier output did not contain a JSON object.");
    }
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("Feedback classifier output JSON must be an object.");
    }
    const category = normaliseCategory(parsed.category);
    if (!category) {
        throw new Error("Feedback classifier output has an unknown category.");
    }
    const confidence = clamp01(readNumber(parsed.confidence, "confidence"));
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim().slice(0, 200) : "";
    const extractedFact =
        typeof parsed.extractedFact === "string" && parsed.extractedFact.trim().length > 0
            ? parsed.extractedFact.trim().slice(0, 500)
            : undefined;
    return { category, confidence, rationale, extractedFact };
}

function extractJsonObject(text: string): string | undefined {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    return text.slice(start, end + 1);
}

function normaliseCategory(value: unknown): FeedbackCategory | undefined {
    if (typeof value !== "string") return undefined;
    const known = Object.values(FeedbackCategory) as string[];
    return known.includes(value) ? (value as FeedbackCategory) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readNumber(value: unknown, field: string): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    throw new Error(`Feedback classifier output ${field} must be a finite number.`);
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

/**
 * 黑板 worker 输出规范化（纯函数，零 I/O）。
 *
 * 拆分目的：CPU 解析 / 字段裁剪 / outcome 推导可单独在 Bun Worker 线程里跑，
 * 避免在主线程上阻塞事件循环。本模块**不引入任何动态依赖**，确保
 * `bun build --compile` 与 Worker entry 都能直接打包。
 *
 * 输入：模型原始字符串 + 任务上下文；输出：BlackboardWorkerResult。
 */
import {
    BlackboardWorkerOutcome,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
} from "../di/index.ts";

export function normalizeBlackboardWorkerOutput(
    input: BlackboardWorkerTask,
    participant: string,
    raw: string,
): BlackboardWorkerResult {
    const parsed = parseModelWorkerJson(raw);
    if (isBlackboardWorkerResultLike(parsed)) {
        const openIssues = stringArray(parsed.openIssues);
        const blockers = stringArray(parsed.blockers);
        const questions = stringArray(parsed.questions);
        const outputSummary = requiredString(parsed.outputSummary, "outputSummary");
        return {
            inputSummary: stringValue(parsed.inputSummary) || defaultInputSummary(input),
            outputSummary,
            newFacts: stringArray(parsed.newFacts),
            blockers,
            risk: riskValue(parsed.risk),
            agreement: booleanValue(parsed.agreement),
            answers: stringArray(parsed.answers),
            discussion: discussionArray(parsed.discussion, participant, outputSummary),
            metadata: {
                modelBacked: true,
                worker: input.workerRole,
            },
            openIssues,
            outcome: outcomeValue(parsed.outcome, openIssues, blockers, questions),
            proposal: stringValue(parsed.proposal) || undefined,
            questions,
        };
    }
    // 这里是模型输出规范化边界。非 JSON 草稿仍然保留为 worker 发言，
    // 后续黑板轮次继续依赖结构化 outcome 收敛，而不是丢弃整轮上下文。
    const outputSummary = compactWorkerText(raw);
    return {
        inputSummary: defaultInputSummary(input),
        outputSummary,
        newFacts: [],
        blockers: [],
        risk: "low",
        agreement: undefined,
        answers: [],
        discussion: discussionArray(undefined, participant, outputSummary),
        metadata: {
            modelBacked: false,
            worker: input.workerRole,
        },
        openIssues: [],
        outcome: BlackboardWorkerOutcome.Continue,
        questions: [],
    };
}

function parseModelWorkerJson(raw: string): unknown | null {
    const text = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
    const candidate = fenced?.[1] ?? text;
    try {
        return JSON.parse(candidate);
    } catch (error) {
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

function isBlackboardWorkerResultLike(value: unknown): value is Record<string, unknown> {
    return (
        !!value && typeof value === "object" && typeof (value as { outputSummary?: unknown }).outputSummary === "string"
    );
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, field: string): string {
    const text = stringValue(value);
    if (!text) {
        throw new Error(`Blackboard worker model returned invalid ${field}.`);
    }
    return text;
}

function defaultInputSummary(input: BlackboardWorkerTask): string {
    return compactWorkerText(input.goal || input.prompt || input.turnId);
}

function compactWorkerText(value: string): string {
    const text = value.replace(/\s+/gu, " ").trim();
    return (text || "(empty worker output)").slice(0, 1_000);
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function riskValue(value: unknown): "low" | "medium" | "high" {
    if (value === "low" || value === "medium" || value === "high") {
        return value;
    }
    return "low";
}

function outcomeValue(
    value: unknown,
    openIssues: string[],
    blockers: string[],
    questions: string[],
): BlackboardWorkerOutcome {
    if (value === BlackboardWorkerOutcome.Blocked) {
        return BlackboardWorkerOutcome.Blocked;
    }
    if (
        value === BlackboardWorkerOutcome.Final &&
        openIssues.length === 0 &&
        blockers.length === 0 &&
        questions.length === 0
    ) {
        return BlackboardWorkerOutcome.Final;
    }
    if (value === BlackboardWorkerOutcome.Continue) {
        return BlackboardWorkerOutcome.Continue;
    }
    return BlackboardWorkerOutcome.Continue;
}

function discussionArray(
    value: unknown,
    participant: string,
    fallbackContent: string,
): BlackboardWorkerResult["discussion"] {
    if (!Array.isArray(value)) {
        return [
            {
                role: discussionRole(undefined, participant),
                content: fallbackContent,
                visibility: "public",
            },
        ];
    }
    const discussion = value
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
            role: discussionRole(item.role, participant),
            content: stringValue(item.content),
            visibility: discussionVisibility(item.visibility),
        }))
        .filter((item) => item.content)
        .slice(0, 6);
    if (discussion.length === 0) {
        return [
            {
                role: discussionRole(undefined, participant),
                content: fallbackContent,
                visibility: "public",
            },
        ];
    }
    return discussion;
}

function discussionRole(value: unknown, participant: string): string {
    const explicit = stringValue(value);
    if (explicit) {
        return normalizeDiscussionRole(explicit);
    }
    return normalizeDiscussionRole(participant) || "worker";
}

function normalizeDiscussionRole(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_.-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 64);
}

function discussionVisibility(value: unknown): "debug" | "internal" | "public" {
    return value === "debug" || value === "internal" || value === "public" ? value : "public";
}

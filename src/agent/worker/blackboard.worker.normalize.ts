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
        return {
            inputSummary: stringValue(parsed.inputSummary) || compactInputSummary(input),
            outputSummary: stringValue(parsed.outputSummary) || truncate(raw, 600),
            newFacts: stringArray(parsed.newFacts),
            blockers,
            risk: riskValue(parsed.risk),
            agreement: booleanValue(parsed.agreement),
            answers: stringArray(parsed.answers),
            discussion: discussionArray(parsed.discussion, participant, stringValue(parsed.outputSummary) || raw),
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
    return {
        inputSummary: compactInputSummary(input),
        outputSummary: truncate(raw.replace(/\s+/g, " ").trim(), 600),
        newFacts: [],
        blockers: [],
        risk: "medium",
        agreement: false,
        discussion: [{ role: "worker", content: raw.trim(), visibility: "public" }],
        metadata: {
            modelBacked: true,
            parseStatus: "raw-text",
            worker: input.workerRole,
        },
        openIssues: ["model_worker_result_was_not_structured"],
        outcome: BlackboardWorkerOutcome.Continue,
        questions: [],
    };
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function compactInputSummary(input: BlackboardWorkerTask): string {
    return `round=${input.round}; worker=${input.workerRole}; goal=${truncate(input.goal, 120)}`;
}

function parseModelWorkerJson(raw: string): unknown {
    const text = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(text);
    const candidate = fenced?.[1] ?? text;
    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return undefined;
            }
        }
        return undefined;
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
    return value === "low" || value === "medium" || value === "high" ? value : "medium";
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
    return BlackboardWorkerOutcome.Continue;
}

function discussionArray(value: unknown, participant: string, fallback: string): BlackboardWorkerResult["discussion"] {
    if (!Array.isArray(value)) {
        return [{ role: discussionRole(undefined, participant), content: fallback, visibility: "public" }];
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
    return discussion.length > 0
        ? discussion
        : [{ role: discussionRole(undefined, participant), content: fallback, visibility: "public" }];
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

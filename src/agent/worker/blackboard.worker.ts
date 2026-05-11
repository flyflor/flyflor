import {
    BlackboardWorkerOutcome,
    ModelRole,
    WorkerInteractionKind,
    WorkerRuntimeKind,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
    type ModelClient,
} from "../di/index.ts";
import type { WorkerManager } from "./worker.manager.ts";
import type { WorkerAdapter, WorkerRunContext } from "./types.ts";

export const BLACKBOARD_MODEL_WORKER_NAME = "blackboard-model-worker";

export interface ModelBackedBlackboardWorkerPrompts {
    systemPrompt(participant: string): string;
}

class ModelBackedBlackboardWorker {
    constructor(
        private readonly model: ModelClient,
        private readonly prompts: ModelBackedBlackboardWorkerPrompts,
    ) {}

    run(input: BlackboardWorkerTask, _context: WorkerRunContext): Promise<BlackboardWorkerResult> {
        return runModelBackedWorker(this.model, input, input.workerRole, this.prompts);
    }
}

class ModelBackedBlackboardWorkerAdapter implements WorkerAdapter<
    ModelBackedBlackboardWorker,
    BlackboardWorkerTask,
    BlackboardWorkerResult
> {
    readonly interaction = WorkerInteractionKind.OneShot;
    readonly runtime = WorkerRuntimeKind.InProcess;

    run(
        target: ModelBackedBlackboardWorker,
        input: BlackboardWorkerTask,
        context: WorkerRunContext,
    ): Promise<BlackboardWorkerResult> {
        return target.run(input, context);
    }
}

export function registerModelBackedBlackboardWorker(
    manager: WorkerManager,
    model: ModelClient,
    prompts: ModelBackedBlackboardWorkerPrompts,
): void {
    if (manager.has(BLACKBOARD_MODEL_WORKER_NAME)) {
        return;
    }
    manager.registerDynamic<ModelBackedBlackboardWorker, BlackboardWorkerTask, BlackboardWorkerResult>(
        new ModelBackedBlackboardWorker(model, prompts),
        new ModelBackedBlackboardWorkerAdapter(),
        {
            manifest: {
                name: BLACKBOARD_MODEL_WORKER_NAME,
                description:
                    "Generic model-backed blackboard worker. The prompt-selected participant role is carried in the task envelope.",
                tags: ["blackboard", "model-backed"],
            },
        },
    );
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

async function runModelBackedWorker(
    model: ModelClient,
    input: BlackboardWorkerTask,
    participant: string,
    prompts: ModelBackedBlackboardWorkerPrompts,
): Promise<BlackboardWorkerResult> {
    const raw = await model.generate([
        {
            role: ModelRole.System,
            content: prompts.systemPrompt(participant),
        },
        {
            role: ModelRole.User,
            content: input.prompt ?? JSON.stringify(input),
        },
    ]);
    return normalizeModelWorkerResult(input, participant, raw);
}

function normalizeModelWorkerResult(
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

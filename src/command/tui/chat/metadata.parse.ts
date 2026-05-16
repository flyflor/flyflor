import type {
    AskChoiceMeta,
    AskMeta,
    AskQuestionMeta,
    BlackboardMeta,
    ContextForkMeta,
    McpTrace,
    PlanningMeta,
    SceneRecordMeta,
    TaskPlanMeta,
    TaskPlanStepMeta,
} from "./types.ts";

export function readRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function readString(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    return undefined;
}

function readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
}

export function readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
    return [];
}

export function readBlackboardMeta(meta: Record<string, unknown> | null): BlackboardMeta | null {
    if (!meta) return null;
    const record = readRecord(meta.blackboard) ?? readRecord(meta);
    if (!record) return null;
    const mode = readString(record.mode) ?? readString(record.blackboardMode);
    if (!mode) return null;
    return {
        mode,
        elapsedMs: readNumber(record.elapsedMs) ?? readNumber(record.blackboardElapsedMs),
        messages: readNumber(record.messages) ?? readNumber(record.blackboardMessages),
        reason: readString(record.reason) ?? readString(record.blackboardReason),
        status: readString(record.status) ?? readString(record.blackboardStatus),
        turnId: readString(record.turnId) ?? readString(record.blackboardTurnId),
    };
}

export function readAskMeta(meta: Record<string, unknown> | null): AskMeta | null {
    if (!meta || meta.kind !== "ask") return null;
    const record = readRecord(meta.ask);
    if (!record) throw invalidAskMeta("ask", "missing object");
    const choiceArray = readAskChoices(record.choices, "ask.choices");
    const questionArray = readAskQuestions(record.questions, "ask.questions");
    const choiceCount = readStrictNumber(record.choiceCount, "ask.choiceCount");
    const questionCount = readStrictNumber(record.questionCount, "ask.questionCount");
    const prompt = readStrictString(record.prompt, "ask.prompt");
    const freeform = typeof record.freeform === "boolean" ? record.freeform : undefined;
    return {
        choiceCount,
        choices: choiceArray,
        freeform,
        prompt,
        questionCount,
        questions: questionArray,
        reason: readStrictString(record.reason, "ask.reason"),
        snapshotId: readStrictString(record.snapshotId, "ask.snapshotId"),
    };
}

export function readPlanningMeta(meta: Record<string, unknown> | null): PlanningMeta | null {
    if (!meta) return null;
    const record = readRecord(meta.planning);
    if (!record) return null;
    const taskPlans = readTaskPlans(record.taskPlans);
    const contextForks = readContextForks(record.contextForks);
    const scenes = readScenes(record.scenes);
    if (taskPlans.length === 0 && contextForks.length === 0 && scenes.length === 0) return null;
    return { contextForks, scenes, taskPlans };
}

function readTaskPlans(value: unknown): TaskPlanMeta[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
        const record = readRecord(raw);
        const id = readString(record?.id);
        const title = readString(record?.title);
        const summary = readString(record?.summary);
        const status = readString(record?.status);
        const progress = readNumber(record?.progress);
        const stepCount = readNumber(record?.stepCount);
        const completedStepCount = readNumber(record?.completedStepCount);
        if (!record || !id || !title || !summary || !status || progress === undefined || stepCount === undefined || completedStepCount === undefined) {
            return [];
        }
        return [{
            id,
            title,
            summary,
            status,
            progress,
            stepCount,
            completedStepCount,
            steps: readTaskPlanSteps(record.steps),
        }];
    });
}

function readTaskPlanSteps(value: unknown): TaskPlanStepMeta[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const steps = value.flatMap((raw) => {
        const record = readRecord(raw);
        const id = readString(record?.id);
        const title = readString(record?.title);
        const status = readString(record?.status);
        const order = readNumber(record?.order);
        if (!record || !id || !title || !status || order === undefined) return [];
        return [{ id, title, status, order, progress: readNumber(record.progress) }];
    });
    return steps.length > 0 ? steps : undefined;
}

function readContextForks(value: unknown): ContextForkMeta[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
        const record = readRecord(raw);
        const id = readString(record?.id);
        const title = readString(record?.title);
        const scopeSummary = readString(record?.scopeSummary);
        const maxContextTokens = readNumber(record?.maxContextTokens);
        if (!record || !id || !title || !scopeSummary || maxContextTokens === undefined) return [];
        return [{ id, title, scopeSummary, maxContextTokens }];
    });
}

function readScenes(value: unknown): SceneRecordMeta[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw) => {
        const record = readRecord(raw);
        const id = readString(record?.id);
        const kind = readString(record?.kind);
        const title = readString(record?.title);
        const summary = readString(record?.summary);
        if (!record || !id || !kind || !title || !summary) return [];
        return [{
            id,
            kind,
            title,
            summary,
            detail: readString(record.detail),
            blackboardTurnId: readString(record.blackboardTurnId),
            taskPlanId: readString(record.taskPlanId),
            contextForkId: readString(record.contextForkId),
        }];
    });
}

function readAskChoices(value: unknown, path: string): AskChoiceMeta[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw invalidAskMeta(path, "expected array");
    const out: AskChoiceMeta[] = [];
    value.forEach((raw, index) => {
        const record = readRecord(raw);
        if (!record) throw invalidAskMeta(`${path}[${index}]`, "expected object");
        const label = readStrictString(record.label, `${path}[${index}].label`);
        const choice: AskChoiceMeta = { label: label.slice(0, 200) };
        const choiceValue = readString(record.value)?.trim();
        if (choiceValue) choice.value = choiceValue.slice(0, 200);
        const description = readString(record.description)?.trim();
        if (description) choice.description = description.slice(0, 500);
        out.push(choice);
    });
    return out;
}

function readAskQuestions(value: unknown, path: string): AskQuestionMeta[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw invalidAskMeta(path, "expected array");
    const out: AskQuestionMeta[] = [];
    value.forEach((raw, index) => {
        const record = readRecord(raw);
        if (!record) throw invalidAskMeta(`${path}[${index}]`, "expected object");
        const prompt = readStrictString(record.prompt, `${path}[${index}].prompt`);
        const question: AskQuestionMeta = { prompt: prompt.slice(0, 500) };
        const id = readString(record.id)?.trim();
        if (id) question.id = id.slice(0, 100);
        const choices = readAskChoices(record.choices, `${path}[${index}].choices`);
        if (choices !== undefined) question.choices = choices;
        if (typeof record.freeform === "boolean") question.freeform = record.freeform;
        const relatedIds = readStringArray(record.relatedIds);
        if (relatedIds.length > 0) question.relatedIds = relatedIds.slice(0, 16);
        const rationale = readString(record.rationale)?.trim();
        if (rationale) question.rationale = rationale.slice(0, 500);
        out.push(question);
    });
    return out;
}

function readStrictString(value: unknown, path: string): string {
    const text = readString(value)?.trim();
    if (!text) throw invalidAskMeta(path, "missing string");
    return text;
}

function readStrictNumber(value: unknown, path: string): number {
    const number = readNumber(value);
    if (number === undefined) throw invalidAskMeta(path, "missing number");
    return number;
}

function invalidAskMeta(path: string, reason: string): Error {
    return new Error(`Invalid ask metadata at ${path}: ${reason}`);
}

export function readMcpTrace(entry: unknown): McpTrace | null {
    const record = readRecord(entry);
    if (!record) return null;
    const resultSummaryMeta = readRecord(record.resultSummaryMeta) ?? readRecord(record.summary);
    return {
        ok: record.ok === true,
        resultText: readString(record.resultSummary) ?? readString(record.resultText) ?? renderMcpSummaryMeta(resultSummaryMeta),
        ...(resultSummaryMeta ? { resultSummaryMeta } : {}),
        server: readString(record.server) ?? "",
        tool: readString(record.tool) ?? "",
    };
}

function renderMcpSummaryMeta(meta: Record<string, unknown> | null): string {
    if (!meta) return "";
    const kind = readString(meta.kind);
    const chars = readNumber(meta.originalChars) ?? readNumber(meta.chars);
    const keys = readNumber(meta.keyCount);
    const items = readNumber(meta.items);
    return [
        kind ? `kind=${kind}` : undefined,
        chars !== undefined ? `chars=${chars}` : undefined,
        keys !== undefined ? `keys=${keys}` : undefined,
        items !== undefined ? `items=${items}` : undefined,
    ].filter((part): part is string => Boolean(part)).join(" ");
}

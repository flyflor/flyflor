import type {
    ContextForkRecord,
    SceneRecord,
    SceneRecordKind,
    TaskPlanRecord,
    TaskPlanStatus,
    TaskPlanStepRecord,
} from "../../protocol/contracts/index.ts";
import { SceneRecordKind as SceneRecordKindEnum, TaskPlanStatus as TaskPlanStatusEnum } from "../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../protocol/index.ts";

/**
 * Runtime parser for planning/fork/history protocol blocks.
 *
 * The model is the only semantic planner. This parser only validates JSON
 * shape, clamps resource fields, assigns ids/timestamps, and strips internal
 * blocks from visible replies.
 */
export interface ParsedPlanningBlocks {
    contextForks: ContextForkRecord[];
    dropped: number;
    sceneRecords: SceneRecord[];
    taskPlans: TaskPlanRecord[];
    text: string;
}

export interface PlanningBlockParseContext {
    blackboardTurnId?: string;
    now: string;
    requestId: string;
    sourceAskId?: string;
    sourceEventId?: string;
    userId: string;
}

const VALID_TASK_STATUSES = new Set<string>(Object.values(TaskPlanStatusEnum));
const VALID_SCENE_KINDS = new Set<string>(Object.values(SceneRecordKindEnum));

export function parsePlanningBlocks(rawText: string, context: PlanningBlockParseContext): ParsedPlanningBlocks {
    let text = rawText;
    let dropped = 0;
    const taskPlans: TaskPlanRecord[] = [];
    const contextForks: ContextForkRecord[] = [];
    const sceneRecords: SceneRecord[] = [];

    const taskPlanResult = extractStructuredBlocks(text, StructuredBlockProtocol.TaskPlan);
    text = taskPlanResult.text;
    for (const block of taskPlanResult.blocks) {
        try {
            taskPlans.push(...readTaskPlans(block.content, context));
        } catch {
            dropped += 1;
        }
    }

    const forkResult = extractStructuredBlocks(text, StructuredBlockProtocol.ContextFork);
    text = forkResult.text;
    for (const block of forkResult.blocks) {
        try {
            contextForks.push(...readContextForks(block.content, context));
        } catch {
            dropped += 1;
        }
    }

    const sceneResult = extractStructuredBlocks(text, StructuredBlockProtocol.SceneRecord);
    text = sceneResult.text;
    for (const block of sceneResult.blocks) {
        try {
            sceneRecords.push(...readSceneRecords(block.content, context));
        } catch {
            dropped += 1;
        }
    }

    return {
        contextForks: contextForks.slice(0, 4),
        dropped,
        sceneRecords: sceneRecords.slice(0, 8),
        taskPlans: taskPlans.slice(0, 4),
        text,
    };
}

function readTaskPlans(rawJson: string, context: PlanningBlockParseContext): TaskPlanRecord[] {
    const payload = parseStructuredJson(rawJson);
    const items = arrayPayload(payload, "plans");
    return items.map((item) => normalizeTaskPlan(item, context));
}

function normalizeTaskPlan(value: unknown, context: PlanningBlockParseContext): TaskPlanRecord {
    const record = requireRecord(value, "flyflor_task_plan item");
    const now = normalizeIso(context.now);
    const steps = readSteps(record.steps ?? record.step);
    const completedStepCount = steps.filter((step) => step.status === TaskPlanStatusEnum.Done).length;
    const status = readTaskStatus(record.status) ?? derivePlanStatus(steps);
    const progress = clamp01(readNumber(record.progress) ?? (steps.length > 0 ? completedStepCount / steps.length : 0));
    return {
        id: readNonEmptyString(record.id)?.slice(0, 120) ?? `plan-${crypto.randomUUID()}`,
        userId: context.userId,
        title: requiredText(record.title, "flyflor_task_plan.title", 160),
        summary: requiredText(record.summary, "flyflor_task_plan.summary", 1200),
        status,
        progress,
        stepCount: steps.length,
        completedStepCount,
        ...(steps.length > 0 ? { step: steps } : {}),
        createdAt: readIso(record.createdAt) ?? now,
        updatedAt: readIso(record.updatedAt) ?? now,
        sourceEventId: readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
        sourceAskId: readNonEmptyString(record.sourceAskId) ?? context.sourceAskId,
        sourceBlackboardTurnId: readNonEmptyString(record.sourceBlackboardTurnId) ?? context.blackboardTurnId,
        sourceSceneId: readNonEmptyString(record.sourceSceneId),
    };
}

function readSteps(value: unknown): TaskPlanStepRecord[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 24).flatMap((raw, index) => {
        if (!isRecord(raw)) return [];
        const title = readNonEmptyString(raw.title);
        if (!title) return [];
        return [{
            id: readNonEmptyString(raw.id)?.slice(0, 120) ?? `step-${index + 1}`,
            title: title.slice(0, 180),
            detail: readNonEmptyString(raw.detail)?.slice(0, 500),
            status: readTaskStatus(raw.status) ?? TaskPlanStatusEnum.Planned,
            order: Math.max(0, Math.floor(readNumber(raw.order) ?? index)),
            progress: clampOptional01(readNumber(raw.progress)),
        }];
    });
}

function derivePlanStatus(steps: TaskPlanStepRecord[]): TaskPlanStatus {
    if (steps.length === 0) return TaskPlanStatusEnum.Planned;
    if (steps.every((step) => step.status === TaskPlanStatusEnum.Done)) return TaskPlanStatusEnum.Done;
    if (steps.some((step) => step.status === TaskPlanStatusEnum.Blocked)) return TaskPlanStatusEnum.Blocked;
    if (steps.some((step) => step.status === TaskPlanStatusEnum.InProgress)) return TaskPlanStatusEnum.InProgress;
    return TaskPlanStatusEnum.Planned;
}

function readContextForks(rawJson: string, context: PlanningBlockParseContext): ContextForkRecord[] {
    const payload = parseStructuredJson(rawJson);
    const items = arrayPayload(payload, "forks");
    return items.map((item) => normalizeContextFork(item, context));
}

function normalizeContextFork(value: unknown, context: PlanningBlockParseContext): ContextForkRecord {
    const record = requireRecord(value, "flyflor_context_fork item");
    const now = normalizeIso(context.now);
    const inheritedEventIds = readStringArray(record.inheritedEventIds).slice(0, 64);
    if (context.sourceEventId && !inheritedEventIds.includes(context.sourceEventId)) {
        inheritedEventIds.unshift(context.sourceEventId);
    }
    return {
        id: readNonEmptyString(record.id)?.slice(0, 120) ?? `fork-${crypto.randomUUID()}`,
        userId: context.userId,
        parentId: readNonEmptyString(record.parentId)?.slice(0, 120),
        title: requiredText(record.title, "flyflor_context_fork.title", 160),
        summary: requiredText(record.summary, "flyflor_context_fork.summary", 1200),
        scopeSummary: requiredText(record.scopeSummary, "flyflor_context_fork.scopeSummary", 1200),
        maxContextTokens: clampInt(readNumber(record.maxContextTokens) ?? 12_000, 1_000, 200_000),
        inheritedEventIds,
        createdAt: readIso(record.createdAt) ?? now,
        updatedAt: readIso(record.updatedAt) ?? now,
        sourceEventId: readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
        sourceAskId: readNonEmptyString(record.sourceAskId) ?? context.sourceAskId,
        sourceBlackboardTurnId: readNonEmptyString(record.sourceBlackboardTurnId) ?? context.blackboardTurnId,
    };
}

function readSceneRecords(rawJson: string, context: PlanningBlockParseContext): SceneRecord[] {
    const payload = parseStructuredJson(rawJson);
    const items = arrayPayload(payload, "scenes");
    return items.map((item) => normalizeSceneRecord(item, context));
}

function normalizeSceneRecord(value: unknown, context: PlanningBlockParseContext): SceneRecord {
    const record = requireRecord(value, "flyflor_scene_record item");
    const now = normalizeIso(context.now);
    return {
        id: readNonEmptyString(record.id)?.slice(0, 120) ?? `scene-${crypto.randomUUID()}`,
        userId: context.userId,
        kind: readSceneKind(record.kind) ?? SceneRecordKindEnum.DeepThink,
        title: requiredText(record.title, "flyflor_scene_record.title", 160),
        summary: requiredText(record.summary, "flyflor_scene_record.summary", 1600),
        detail: readNonEmptyString(record.detail)?.slice(0, 4000),
        visibleFacts: readStringArray(record.visibleFacts).slice(0, 24),
        openQuestions: readStringArray(record.openQuestions).slice(0, 16),
        taskPlanId: readNonEmptyString(record.taskPlanId)?.slice(0, 120),
        contextForkId: readNonEmptyString(record.contextForkId)?.slice(0, 120),
        blackboardTurnId: readNonEmptyString(record.blackboardTurnId) ?? context.blackboardTurnId,
        sourceEventId: readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
        createdAt: readIso(record.createdAt) ?? now,
        updatedAt: readIso(record.updatedAt) ?? now,
    };
}

function arrayPayload(payload: unknown, arrayKey: string): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (isRecord(payload) && Array.isArray(payload[arrayKey])) return payload[arrayKey];
    if (isRecord(payload)) return [payload];
    throw new Error(`Structured planning block must be an object, array, or object with ${arrayKey}[].`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
    return value;
}

function requiredText(value: unknown, path: string, max: number): string {
    const text = readNonEmptyString(value);
    if (!text) throw new Error(`${path} is required.`);
    return text.slice(0, max);
}

function readTaskStatus(value: unknown): TaskPlanStatus | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return VALID_TASK_STATUSES.has(trimmed) ? (trimmed as TaskPlanStatus) : undefined;
}

function readSceneKind(value: unknown): SceneRecordKind | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return VALID_SCENE_KINDS.has(trimmed) ? (trimmed as SceneRecordKind) : undefined;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.replace(/\s+/gu, " ").trim().slice(0, 500));
}

function readNonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.replace(/\s+/gu, " ").trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readIso(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizeIso(value: string): string {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function clampOptional01(value: number | undefined): number | undefined {
    return value === undefined ? undefined : clamp01(value);
}

function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

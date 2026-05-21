import type {
    ContextForkRecord,
    ReplayRecord,
    ReplayRecordKind,
    TaskPlanRecord,
    TaskPlanStatus,
    TaskPlanStepRecord,
} from "../../../protocol/contracts/index.ts";
import {
    ReplayRecordKind as ReplayRecordKindEnum,
    TaskPlanStatus as TaskPlanStatusEnum,
} from "../../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../../protocol/index.ts";

/**
 * Parsed internal planning protocol blocks.
 *
 * The parser never infers user intent from visible text. It only consumes
 * structured model-emitted blocks that were registered in the protocol layer.
 */
export interface ParsedPlanningBlocks {
    contextForks: ContextForkRecord[];
    dropped: number;
    replayRecords: ReplayRecord[];
    taskPlans: TaskPlanRecord[];
    text: string;
}

export interface PlanningBlockParseContext {
    blackboardTurnId?: string;
    now: string;
    ownerKey: string;
    requestId: string;
    sourceAskId?: string;
    sourceEventId?: string;
    sourceKey?: string;
}

const VALID_TASK_STATUSES = new Set<string>(Object.values(TaskPlanStatusEnum));
const VALID_REPLAY_KINDS = new Set<string>(Object.values(ReplayRecordKindEnum));

export class PlanningBlockParser {
    public parse(rawText: string, context: PlanningBlockParseContext): ParsedPlanningBlocks {
        let text = rawText;
        let dropped = 0;
        const taskPlans: TaskPlanRecord[] = [];
        const contextForks: ContextForkRecord[] = [];
        const replayRecords: ReplayRecord[] = [];

        const taskPlanResult = extractStructuredBlocks(text, StructuredBlockProtocol.TaskPlan);
        text = taskPlanResult.text;
        for (const block of taskPlanResult.blocks) {
            try {
                taskPlans.push(...this.readTaskPlans(block.content, context));
            } catch {
                dropped += 1;
            }
        }

        const forkResult = extractStructuredBlocks(text, StructuredBlockProtocol.ContextFork);
        text = forkResult.text;
        for (const block of forkResult.blocks) {
            try {
                contextForks.push(...this.readContextForks(block.content, context));
            } catch {
                dropped += 1;
            }
        }

        const replayResult = extractStructuredBlocks(text, StructuredBlockProtocol.ReplayRecord);
        text = replayResult.text;
        for (const block of replayResult.blocks) {
            try {
                replayRecords.push(...this.readReplayRecords(block.content, context));
            } catch {
                dropped += 1;
            }
        }

        return {
            contextForks: contextForks.slice(0, 4),
            dropped,
            replayRecords: replayRecords.slice(0, 8),
            taskPlans: taskPlans.slice(0, 4),
            text,
        };
    }

    private readTaskPlans(rawJson: string, context: PlanningBlockParseContext): TaskPlanRecord[] {
        const payload = parseStructuredJson(rawJson);
        const items = this.arrayPayload(payload, "plans");
        return items.map((item) => this.normalizeTaskPlan(item, context));
    }

    private normalizeTaskPlan(value: unknown, context: PlanningBlockParseContext): TaskPlanRecord {
        const record = this.requireRecord(value, "flyflor_task_plan item");
        const now = this.normalizeIso(context.now);
        const steps = this.readSteps(record.steps ?? record.step);
        const completedStepCount = steps.filter((step) => step.status === TaskPlanStatusEnum.Done).length;
        const status = this.readTaskStatus(record.status) ?? this.derivePlanStatus(steps);
        const progress = this.clamp01(
            this.readNumber(record.progress) ?? (steps.length > 0 ? completedStepCount / steps.length : 0),
        );
        return {
            id: this.readNonEmptyString(record.id)?.slice(0, 120) ?? `plan-${crypto.randomUUID()}`,
            ownerKey: context.ownerKey,
            sourceKey: context.sourceKey,
            title: this.requiredText(record.title, "flyflor_task_plan.title", 160),
            summary: this.requiredText(record.summary, "flyflor_task_plan.summary", 1200),
            status,
            progress,
            stepCount: steps.length,
            completedStepCount,
            ...(steps.length > 0 ? { step: steps } : {}),
            createdAt: this.readIso(record.createdAt) ?? now,
            updatedAt: this.readIso(record.updatedAt) ?? now,
            sourceEventId: this.readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
            sourceAskId: this.readNonEmptyString(record.sourceAskId) ?? context.sourceAskId,
            sourceBlackboardTurnId: this.readNonEmptyString(record.sourceBlackboardTurnId) ?? context.blackboardTurnId,
            sourceReplayId: this.readNonEmptyString(record.sourceReplayId),
        };
    }

    private readSteps(value: unknown): TaskPlanStepRecord[] {
        if (!Array.isArray(value)) return [];
        return value.slice(0, 24).flatMap((raw, index) => {
            if (!this.isRecord(raw)) return [];
            const title = this.readNonEmptyString(raw.title);
            if (!title) return [];
            return [
                {
                    id: this.readNonEmptyString(raw.id)?.slice(0, 120) ?? `step-${index + 1}`,
                    title: title.slice(0, 180),
                    detail: this.readNonEmptyString(raw.detail)?.slice(0, 500),
                    status: this.readTaskStatus(raw.status) ?? TaskPlanStatusEnum.Planned,
                    order: Math.max(0, Math.floor(this.readNumber(raw.order) ?? index)),
                    progress: this.clampOptional01(this.readNumber(raw.progress)),
                },
            ];
        });
    }

    private derivePlanStatus(steps: TaskPlanStepRecord[]): TaskPlanStatus {
        if (steps.length === 0) return TaskPlanStatusEnum.Planned;
        if (steps.every((step) => step.status === TaskPlanStatusEnum.Done)) return TaskPlanStatusEnum.Done;
        if (steps.some((step) => step.status === TaskPlanStatusEnum.Blocked)) return TaskPlanStatusEnum.Blocked;
        if (steps.some((step) => step.status === TaskPlanStatusEnum.InProgress)) return TaskPlanStatusEnum.InProgress;
        return TaskPlanStatusEnum.Planned;
    }

    private readContextForks(rawJson: string, context: PlanningBlockParseContext): ContextForkRecord[] {
        const payload = parseStructuredJson(rawJson);
        const items = this.arrayPayload(payload, "forks");
        return items.map((item) => this.normalizeContextFork(item, context));
    }

    private normalizeContextFork(value: unknown, context: PlanningBlockParseContext): ContextForkRecord {
        const record = this.requireRecord(value, "flyflor_context_fork item");
        const now = this.normalizeIso(context.now);
        const inheritedEventIds = this.readStringArray(record.inheritedEventIds).slice(0, 64);
        if (context.sourceEventId && !inheritedEventIds.includes(context.sourceEventId)) {
            inheritedEventIds.unshift(context.sourceEventId);
        }
        return {
            id: this.readNonEmptyString(record.id)?.slice(0, 120) ?? `fork-${crypto.randomUUID()}`,
            ownerKey: context.ownerKey,
            sourceKey: context.sourceKey,
            parentId: this.readNonEmptyString(record.parentId)?.slice(0, 120),
            title: this.requiredText(record.title, "flyflor_context_fork.title", 160),
            summary: this.requiredText(record.summary, "flyflor_context_fork.summary", 1200),
            continuitySummary: this.requiredText(record.continuitySummary, "flyflor_context_fork.continuitySummary", 1200),
            maxContextTokens: this.clampInt(this.readNumber(record.maxContextTokens) ?? 12_000, 1_000, 200_000),
            inheritedEventIds,
            createdAt: this.readIso(record.createdAt) ?? now,
            updatedAt: this.readIso(record.updatedAt) ?? now,
            sourceEventId: this.readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
            sourceAskId: this.readNonEmptyString(record.sourceAskId) ?? context.sourceAskId,
            sourceBlackboardTurnId: this.readNonEmptyString(record.sourceBlackboardTurnId) ?? context.blackboardTurnId,
        };
    }

    private readReplayRecords(rawJson: string, context: PlanningBlockParseContext): ReplayRecord[] {
        const payload = parseStructuredJson(rawJson);
        const items = this.arrayPayload(payload, "replays");
        return items.map((item) => this.normalizeReplayRecord(item, context));
    }

    private normalizeReplayRecord(value: unknown, context: PlanningBlockParseContext): ReplayRecord {
        const record = this.requireRecord(value, "flyflor_replay_record item");
        const now = this.normalizeIso(context.now);
        return {
            id: this.readNonEmptyString(record.id)?.slice(0, 120) ?? `replay-${crypto.randomUUID()}`,
            ownerKey: context.ownerKey,
            sourceKey: context.sourceKey,
            kind: this.readReplayKind(record.kind) ?? ReplayRecordKindEnum.DeepThink,
            title: this.requiredText(record.title, "flyflor_replay_record.title", 160),
            summary: this.requiredText(record.summary, "flyflor_replay_record.summary", 1600),
            detail: this.readNonEmptyString(record.detail)?.slice(0, 4000),
            visibleFacts: this.readStringArray(record.visibleFacts).slice(0, 24),
            openQuestions: this.readStringArray(record.openQuestions).slice(0, 16),
            taskPlanId: this.readNonEmptyString(record.taskPlanId)?.slice(0, 120),
            contextForkId: this.readNonEmptyString(record.contextForkId)?.slice(0, 120),
            blackboardTurnId: this.readNonEmptyString(record.blackboardTurnId) ?? context.blackboardTurnId,
            sourceEventId: this.readNonEmptyString(record.sourceEventId) ?? context.sourceEventId,
            createdAt: this.readIso(record.createdAt) ?? now,
            updatedAt: this.readIso(record.updatedAt) ?? now,
        };
    }

    private arrayPayload(payload: unknown, arrayKey: string): unknown[] {
        if (Array.isArray(payload)) return payload;
        if (this.isRecord(payload) && Array.isArray(payload[arrayKey])) return payload[arrayKey];
        if (this.isRecord(payload)) return [payload];
        throw new Error(`Structured planning block must be an object, array, or object with ${arrayKey}[].`);
    }

    private requireRecord(value: unknown, label: string): Record<string, unknown> {
        if (!this.isRecord(value)) throw new Error(`${label} must be a JSON object.`);
        return value;
    }

    private requiredText(value: unknown, path: string, max: number): string {
        const text = this.readNonEmptyString(value);
        if (!text) throw new Error(`${path} is required.`);
        return text.slice(0, max);
    }

    private readTaskStatus(value: unknown): TaskPlanStatus | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return VALID_TASK_STATUSES.has(trimmed) ? (trimmed as TaskPlanStatus) : undefined;
    }

    private readReplayKind(value: unknown): ReplayRecordKind | undefined {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return VALID_REPLAY_KINDS.has(trimmed) ? (trimmed as ReplayRecordKind) : undefined;
    }

    private readStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.replace(/\s+/gu, " ").trim().slice(0, 500));
    }

    private readNonEmptyString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.replace(/\s+/gu, " ").trim() : undefined;
    }

    private readNumber(value: unknown): number | undefined {
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

    private readIso(value: unknown): string | undefined {
        if (typeof value !== "string") return undefined;
        const time = Date.parse(value);
        return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
    }

    private normalizeIso(value: string): string {
        const time = Date.parse(value);
        return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private clampOptional01(value: number | undefined): number | undefined {
        return value === undefined ? undefined : this.clamp01(value);
    }

    private clampInt(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, Math.floor(value)));
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

const defaultParser = new PlanningBlockParser();

/**
 * Backward-compatible runtime entry for planning/fork/history blocks.
 * New code should inject or own `PlanningBlockParser` directly.
 */
export function parsePlanningBlocks(rawText: string, context: PlanningBlockParseContext): ParsedPlanningBlocks {
    return defaultParser.parse(rawText, context);
}

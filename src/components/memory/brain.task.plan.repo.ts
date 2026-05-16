import type { Database } from "bun:sqlite";
import type { TaskPlanRecord, TaskPlanStepRecord } from "../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../sql/index.ts";

export interface BrainTaskPlanRow {
    completed_step_count: number;
    created_at: string;
    id: string;
    progress: number;
    source_ask_id: string | null;
    source_blackboard_turn_id: string | null;
    source_event_id: string | null;
    source_scene_id: string | null;
    status: string;
    step_count: number;
    steps_json: string;
    summary: string;
    title: string;
    updated_at: string;
    user_id: string;
}

/**
 * Repo for `task_plans`.
 *
 * The table stores summary-first TODO state for TUI/history. It never receives
 * raw chain-of-thought or model scratchpad text.
 */
export class BrainTaskPlanRepo {
    public constructor(private readonly db: Database) {}

    public write(record: TaskPlanRecord): TaskPlanRecord {
        runQuery(
            this.db,
            query`INSERT INTO task_plans (
                id, user_id, title, summary, status, progress, step_count, completed_step_count,
                steps_json, created_at, updated_at, source_event_id, source_ask_id,
                source_blackboard_turn_id, source_scene_id
            ) VALUES (
                ${record.id}, ${record.userId}, ${record.title}, ${record.summary},
                ${record.status}, ${record.progress}, ${record.stepCount},
                ${record.completedStepCount}, ${JSON.stringify(record.step ?? [])},
                ${record.createdAt}, ${record.updatedAt}, ${record.sourceEventId ?? null},
                ${record.sourceAskId ?? null}, ${record.sourceBlackboardTurnId ?? null},
                ${record.sourceSceneId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                summary = excluded.summary,
                status = excluded.status,
                progress = excluded.progress,
                step_count = excluded.step_count,
                completed_step_count = excluded.completed_step_count,
                steps_json = excluded.steps_json,
                updated_at = excluded.updated_at,
                source_event_id = excluded.source_event_id,
                source_ask_id = excluded.source_ask_id,
                source_blackboard_turn_id = excluded.source_blackboard_turn_id,
                source_scene_id = excluded.source_scene_id`,
        );
        return record;
    }

    public list(input: {
        limit?: number;
        sourceBlackboardTurnId?: string;
        sourceEventId?: string;
        userId?: string;
    } = {}): TaskPlanRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceBlackboardTurnId = input.sourceBlackboardTurnId ?? null;
        const sourceEventId = input.sourceEventId ?? null;
        const userId = input.userId ?? null;
        const rows = allQuery<BrainTaskPlanRow>(
            this.db,
            query`SELECT * FROM task_plans
                WHERE (${userId} IS NULL OR user_id = ${userId})
                  AND (${sourceEventId} IS NULL OR source_event_id = ${sourceEventId})
                  AND (${sourceBlackboardTurnId} IS NULL OR source_blackboard_turn_id = ${sourceBlackboardTurnId})
                ORDER BY updated_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => this.toRecord(row));
    }

    private toRecord(row: BrainTaskPlanRow): TaskPlanRecord {
        const steps = parseJsonArray(row.steps_json).filter(isTaskPlanStepRecord);
        return {
            id: row.id,
            userId: row.user_id,
            title: row.title,
            summary: row.summary,
            status: row.status as TaskPlanRecord["status"],
            progress: row.progress,
            stepCount: row.step_count,
            completedStepCount: row.completed_step_count,
            ...(steps.length > 0 ? { step: steps } : {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceEventId: row.source_event_id ?? undefined,
            sourceAskId: row.source_ask_id ?? undefined,
            sourceBlackboardTurnId: row.source_blackboard_turn_id ?? undefined,
            sourceSceneId: row.source_scene_id ?? undefined,
        };
    }
}

function isTaskPlanStepRecord(value: unknown): value is TaskPlanStepRecord {
    if (!isRecord(value)) return false;
    return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.status === "string" &&
        typeof value.order === "number"
    );
}

function parseJsonArray(value: string): unknown[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

import type { Database } from "bun:sqlite";
import type { TaskPlanRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainTaskPlanModel, type BrainTaskPlanRow } from "./entity.ts";

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
        return rows.map((row) => brainTaskPlanModel.toRecord(row));
    }
}

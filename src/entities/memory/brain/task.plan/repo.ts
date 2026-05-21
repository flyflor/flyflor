import type { Database } from "bun:sqlite";
import type { TaskPlanRecord } from "../../../../protocol/contracts/index.ts";
import { query, runQuery } from "../../../../components/sql/index.ts";
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
        const sourceKey = record.sourceKey ?? record.ownerKey;
        runQuery(
            this.db,
            query`INSERT INTO task_plans (
                id, owner_key, source_key, title, summary, status, progress, step_count, completed_step_count,
                steps_json, created_at, updated_at, source_event_id, source_ask_id,
                source_blackboard_turn_id, source_replay_id
            ) VALUES (
                ${record.id}, ${record.ownerKey}, ${sourceKey}, ${record.title}, ${record.summary},
                ${record.status}, ${record.progress}, ${record.stepCount},
                ${record.completedStepCount}, ${JSON.stringify(record.step ?? [])},
                ${record.createdAt}, ${record.updatedAt}, ${record.sourceEventId ?? null},
                ${record.sourceAskId ?? null}, ${record.sourceBlackboardTurnId ?? null},
                ${record.sourceReplayId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                owner_key = excluded.owner_key,
                source_key = excluded.source_key,
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
                source_replay_id = excluded.source_replay_id`,
        );
        return record;
    }

    public list(input: {
        limit?: number;
        sourceBlackboardTurnId?: string;
        sourceEventId?: string;
        ownerKey?: string;
        /** @deprecated Use ownerKey for cognition. */
        sourceKey?: string;
    } = {}): TaskPlanRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceBlackboardTurnId = input.sourceBlackboardTurnId ?? null;
        const sourceEventId = input.sourceEventId ?? null;
        const ownerKey = input.ownerKey ?? input.sourceKey ?? null;
        const rows = this.db
            .query<BrainTaskPlanRow, [string | null, string | null, string | null, number]>(
                `SELECT ${this.selectProjection()} FROM task_plans
                    WHERE (?1 IS NULL OR owner_key = ?1)
                      AND (?2 IS NULL OR source_event_id = ?2)
                      AND (?3 IS NULL OR source_blackboard_turn_id = ?3)
                    ORDER BY updated_at DESC
                    LIMIT ?4`,
            )
            .all(ownerKey, sourceEventId, sourceBlackboardTurnId, limit);
        return rows.map((row) => brainTaskPlanModel.toRecord(row));
    }

    private selectProjection(): string {
        const legacySourceColumn = this.hasColumn("task_plans", "legacy_source_key") ? "legacy_source_key" : "source_key AS legacy_source_key";
        return [
            "completed_step_count",
            "created_at",
            "id",
            "progress",
            "source_ask_id",
            "source_blackboard_turn_id",
            "source_event_id",
            "source_replay_id",
            "status",
            "step_count",
            "steps_json",
            "summary",
            "title",
            "updated_at",
            "owner_key",
            "source_key",
            legacySourceColumn,
        ].join(", ");
    }

    private hasColumn(table: string, column: string): boolean {
        return this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    }
}

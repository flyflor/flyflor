import type { Database } from "bun:sqlite";
import type { SceneRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainSceneRecordModel, type BrainSceneRecordRow } from "./entity.ts";

/**
 * Repo for `scene_records`.
 *
 * Scene replay is a cold history detail path. It stores compact structured
 * facts/questions for `/history` and must not persist raw hidden reasoning.
 */
export class BrainSceneRecordRepo {
    public constructor(private readonly db: Database) {}

    public write(record: SceneRecord): SceneRecord {
        runQuery(
            this.db,
            query`INSERT INTO scene_records (
                id, user_id, kind, title, summary, detail, visible_facts_json,
                open_questions_json, task_plan_id, context_fork_id, blackboard_turn_id,
                source_event_id, created_at, updated_at
            ) VALUES (
                ${record.id}, ${record.userId}, ${record.kind}, ${record.title},
                ${record.summary}, ${record.detail ?? null}, ${JSON.stringify(record.visibleFacts)},
                ${JSON.stringify(record.openQuestions)}, ${record.taskPlanId ?? null},
                ${record.contextForkId ?? null}, ${record.blackboardTurnId ?? null},
                ${record.sourceEventId ?? null}, ${record.createdAt}, ${record.updatedAt}
            )
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                title = excluded.title,
                summary = excluded.summary,
                detail = excluded.detail,
                visible_facts_json = excluded.visible_facts_json,
                open_questions_json = excluded.open_questions_json,
                task_plan_id = excluded.task_plan_id,
                context_fork_id = excluded.context_fork_id,
                blackboard_turn_id = excluded.blackboard_turn_id,
                source_event_id = excluded.source_event_id,
                updated_at = excluded.updated_at`,
        );
        return record;
    }

    public list(input: {
        blackboardTurnId?: string;
        limit?: number;
        sourceEventId?: string;
        userId?: string;
    } = {}): SceneRecord[] {
        const blackboardTurnId = input.blackboardTurnId ?? null;
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceEventId = input.sourceEventId ?? null;
        const userId = input.userId ?? null;
        const rows = allQuery<BrainSceneRecordRow>(
            this.db,
            query`SELECT * FROM scene_records
                WHERE (${userId} IS NULL OR user_id = ${userId})
                  AND (${sourceEventId} IS NULL OR source_event_id = ${sourceEventId})
                  AND (${blackboardTurnId} IS NULL OR blackboard_turn_id = ${blackboardTurnId})
                ORDER BY updated_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainSceneRecordModel.toRecord(row));
    }
}

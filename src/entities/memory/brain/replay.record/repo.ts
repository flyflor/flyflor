import type { Database } from "bun:sqlite";
import type { ReplayRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainReplayRecordModel, type BrainReplayRecordRow } from "./entity.ts";

/**
 * Repo for `replay_records`.
 *
 * Replay is a cold history detail path. It stores compact structured
 * facts/questions for `/history` and must not persist raw hidden reasoning.
 */
export class BrainReplayRecordRepo {
    public constructor(private readonly db: Database) {}

    public write(record: ReplayRecord): ReplayRecord {
        const sourceKey = record.sourceKey ?? record.ownerKey;
        runQuery(
            this.db,
            query`INSERT INTO replay_records (
                id, owner_key, source_key, kind, title, summary, detail, visible_facts_json,
                open_questions_json, task_plan_id, context_fork_id, blackboard_turn_id,
                source_event_id, created_at, updated_at
            ) VALUES (
                ${record.id}, ${record.ownerKey}, ${sourceKey}, ${record.kind}, ${record.title},
                ${record.summary}, ${record.detail ?? null}, ${JSON.stringify(record.visibleFacts)},
                ${JSON.stringify(record.openQuestions)}, ${record.taskPlanId ?? null},
                ${record.contextForkId ?? null}, ${record.blackboardTurnId ?? null},
                ${record.sourceEventId ?? null}, ${record.createdAt}, ${record.updatedAt}
            )
            ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                owner_key = excluded.owner_key,
                source_key = excluded.source_key,
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
        ownerKey?: string;
        sourceEventId?: string;
        /** @deprecated Use ownerKey for cognition. */
        sourceKey?: string;
    } = {}): ReplayRecord[] {
        const blackboardTurnId = input.blackboardTurnId ?? null;
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceEventId = input.sourceEventId ?? null;
        const ownerKey = input.ownerKey ?? input.sourceKey ?? null;
        const tableName = this.replayTableName();
        const projection = this.selectProjection(tableName);
        const rows = this.db
            .query<BrainReplayRecordRow, [string | null, string | null, string | null, number]>(
                `SELECT ${projection} FROM ${tableName}
                    WHERE (?1 IS NULL OR owner_key = ?1)
                      AND (?2 IS NULL OR source_event_id = ?2)
                      AND (?3 IS NULL OR blackboard_turn_id = ?3)
                    ORDER BY updated_at DESC
                    LIMIT ?4`,
            )
            .all(ownerKey, sourceEventId, blackboardTurnId, limit);
        return rows.map((row) => brainReplayRecordModel.toRecord(row));
    }

    private replayTableName(): string {
        const replay = this.db
            .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
            .get("replay_records");
        if (replay) return "replay_records";
        return "scene_records";
    }

    private selectProjection(tableName: string): string {
        const legacySourceColumn = this.hasColumn(tableName, "legacy_source_key") ? "legacy_source_key" : "source_key AS legacy_source_key";
        return [
            "blackboard_turn_id",
            "context_fork_id",
            "created_at",
            "detail",
            "id",
            "kind",
            "open_questions_json",
            "source_event_id",
            "summary",
            "task_plan_id",
            "title",
            "updated_at",
            "owner_key",
            "source_key",
            legacySourceColumn,
            "visible_facts_json",
        ].join(", ");
    }

    private hasColumn(table: string, column: string): boolean {
        return this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    }
}

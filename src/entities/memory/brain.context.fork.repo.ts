import type { Database } from "bun:sqlite";
import type { ContextForkRecord } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../components/sql/index.ts";
import { brainContextForkModel, type BrainContextForkRow } from "./index.ts";

/**
 * Repo for `context_forks`.
 *
 * Forks are explicit context branches selected by TUI/commands. They are stored
 * as structured summaries and inherited ids, not as an implicit session store.
 */
export class BrainContextForkRepo {
    public constructor(private readonly db: Database) {}

    public write(record: ContextForkRecord): ContextForkRecord {
        runQuery(
            this.db,
            query`INSERT INTO context_forks (
                id, user_id, parent_id, title, summary, scope_summary, max_context_tokens,
                inherited_event_ids_json, created_at, updated_at, source_event_id,
                source_ask_id, source_blackboard_turn_id
            ) VALUES (
                ${record.id}, ${record.userId}, ${record.parentId ?? null},
                ${record.title}, ${record.summary}, ${record.scopeSummary},
                ${record.maxContextTokens}, ${JSON.stringify(record.inheritedEventIds)},
                ${record.createdAt}, ${record.updatedAt}, ${record.sourceEventId ?? null},
                ${record.sourceAskId ?? null}, ${record.sourceBlackboardTurnId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                parent_id = excluded.parent_id,
                title = excluded.title,
                summary = excluded.summary,
                scope_summary = excluded.scope_summary,
                max_context_tokens = excluded.max_context_tokens,
                inherited_event_ids_json = excluded.inherited_event_ids_json,
                updated_at = excluded.updated_at,
                source_event_id = excluded.source_event_id,
                source_ask_id = excluded.source_ask_id,
                source_blackboard_turn_id = excluded.source_blackboard_turn_id`,
        );
        return record;
    }

    public get(id: string): ContextForkRecord | null {
        const row = getQuery<BrainContextForkRow>(this.db, query`SELECT * FROM context_forks WHERE id = ${id}`);
        return row ? brainContextForkModel.toRecord(row) : null;
    }

    public list(input: {
        limit?: number;
        sourceBlackboardTurnId?: string;
        sourceEventId?: string;
        userId?: string;
    } = {}): ContextForkRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceBlackboardTurnId = input.sourceBlackboardTurnId ?? null;
        const sourceEventId = input.sourceEventId ?? null;
        const userId = input.userId ?? null;
        const rows = allQuery<BrainContextForkRow>(
            this.db,
            query`SELECT * FROM context_forks
                WHERE (${userId} IS NULL OR user_id = ${userId})
                  AND (${sourceEventId} IS NULL OR source_event_id = ${sourceEventId})
                  AND (${sourceBlackboardTurnId} IS NULL OR source_blackboard_turn_id = ${sourceBlackboardTurnId})
                ORDER BY updated_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainContextForkModel.toRecord(row));
    }
}

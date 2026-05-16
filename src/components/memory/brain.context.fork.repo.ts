import type { Database } from "bun:sqlite";
import type { ContextForkRecord } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../sql/index.ts";

export interface BrainContextForkRow {
    created_at: string;
    id: string;
    inherited_event_ids_json: string;
    max_context_tokens: number;
    parent_id: string | null;
    scope_summary: string;
    source_ask_id: string | null;
    source_blackboard_turn_id: string | null;
    source_event_id: string | null;
    summary: string;
    title: string;
    updated_at: string;
    user_id: string;
}

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
        return row ? this.toRecord(row) : null;
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
        return rows.map((row) => this.toRecord(row));
    }

    private toRecord(row: BrainContextForkRow): ContextForkRecord {
        return {
            id: row.id,
            userId: row.user_id,
            parentId: row.parent_id ?? undefined,
            title: row.title,
            summary: row.summary,
            scopeSummary: row.scope_summary,
            maxContextTokens: row.max_context_tokens,
            inheritedEventIds: parseJsonArray(row.inherited_event_ids_json).filter(
                (item): item is string => typeof item === "string",
            ),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceEventId: row.source_event_id ?? undefined,
            sourceAskId: row.source_ask_id ?? undefined,
            sourceBlackboardTurnId: row.source_blackboard_turn_id ?? undefined,
        };
    }
}

function parseJsonArray(value: string): unknown[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

import type { Database } from "bun:sqlite";
import type { ContextForkRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainContextForkModel, type BrainContextForkRow } from "./entity.ts";

/**
 * Repo for `context_forks`.
 *
 * Forks are explicit context branches selected by TUI/commands. They are stored
 * as structured summaries and inherited ids, not as an implicit session store.
 */
export class BrainContextForkRepo {
    public constructor(private readonly db: Database) {}

    public write(record: ContextForkRecord): ContextForkRecord {
        const sourceKey = record.sourceKey ?? record.ownerKey;
        runQuery(
            this.db,
            query`INSERT INTO context_forks (
                id, owner_key, source_key, parent_id, title, summary, scope_summary, max_context_tokens,
                inherited_event_ids_json, created_at, updated_at, source_event_id,
                source_ask_id, source_blackboard_turn_id
            ) VALUES (
                ${record.id}, ${record.ownerKey}, ${sourceKey}, ${record.parentId ?? null},
                ${record.title}, ${record.summary}, ${record.continuitySummary},
                ${record.maxContextTokens}, ${JSON.stringify(record.inheritedEventIds)},
                ${record.createdAt}, ${record.updatedAt}, ${record.sourceEventId ?? null},
                ${record.sourceAskId ?? null}, ${record.sourceBlackboardTurnId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                parent_id = excluded.parent_id,
                owner_key = excluded.owner_key,
                source_key = excluded.source_key,
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
        const row = this.db
            .query<BrainContextForkRow, [string]>(`SELECT ${this.selectProjection()} FROM context_forks WHERE id = ?1`)
            .get(id);
        return row ? brainContextForkModel.toRecord(row) : null;
    }

    public list(input: {
        limit?: number;
        sourceBlackboardTurnId?: string;
        sourceEventId?: string;
        ownerKey?: string;
        /** @deprecated Use ownerKey for cognition. */
        sourceKey?: string;
    } = {}): ContextForkRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const sourceBlackboardTurnId = input.sourceBlackboardTurnId ?? null;
        const sourceEventId = input.sourceEventId ?? null;
        const ownerKey = input.ownerKey ?? input.sourceKey ?? null;
        const rows = this.db
            .query<BrainContextForkRow, [string | null, string | null, string | null, number]>(
                `SELECT ${this.selectProjection()} FROM context_forks
                    WHERE (?1 IS NULL OR owner_key = ?1)
                      AND (?2 IS NULL OR source_event_id = ?2)
                      AND (?3 IS NULL OR source_blackboard_turn_id = ?3)
                    ORDER BY updated_at DESC
                    LIMIT ?4`,
            )
            .all(ownerKey, sourceEventId, sourceBlackboardTurnId, limit);
        return rows.map((row) => brainContextForkModel.toRecord(row));
    }

    private selectProjection(): string {
        const legacySourceColumn = this.hasColumn("context_forks", "legacy_source_key") ? "legacy_source_key" : "source_key AS legacy_source_key";
        return [
            "created_at",
            "id",
            "inherited_event_ids_json",
            "max_context_tokens",
            "parent_id",
            "scope_summary",
            "source_ask_id",
            "source_blackboard_turn_id",
            "source_event_id",
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

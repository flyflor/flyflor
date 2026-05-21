import type { Database } from "bun:sqlite";
import type { ScopeRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainScopeModel, type BrainScopeRow } from "./entity.ts";

/**
 * Repo for the `scopes` model.
 *
 * It owns SQL and row mapping only. Runtime scope decisions remain in context
 * and memory components so this table cannot become an implicit session layer.
 */
export class BrainScopeRepo {
    public constructor(private readonly db: Database) {}

    public upsert(record: ScopeRecord): ScopeRecord {
        const auditUserId = record.auditUserId ?? record.userId ?? null;
        runQuery(
            this.db,
            query`INSERT INTO scopes (
                id, audit_user_id, title, goal, project_dir, project_memory_dir,
                created_at, updated_at, last_used_at, use_count
            ) VALUES (
                ${record.id}, ${auditUserId}, ${record.title}, ${record.goal ?? null},
                ${record.projectDir}, ${record.projectMemoryDir}, ${record.createdAt},
                ${record.updatedAt}, ${record.lastUsedAt}, ${record.useCount}
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                audit_user_id = excluded.audit_user_id,
                goal = excluded.goal,
                project_dir = excluded.project_dir,
                project_memory_dir = excluded.project_memory_dir,
                updated_at = excluded.updated_at,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count`,
        );
        return record;
    }

    public get(id: string): ScopeRecord | null {
        const row = getQuery<BrainScopeRow>(this.db, query`SELECT * FROM scopes WHERE id = ${id}`);
        return row ? brainScopeModel.toRecord(row) : null;
    }

    public list(input: { auditUserId?: string; limit?: number; userId?: string } = {}): ScopeRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const auditUserId = input.auditUserId ?? input.userId ?? null;
        const rows = allQuery<BrainScopeRow>(
            this.db,
            query`SELECT * FROM scopes
                WHERE (${auditUserId} IS NULL OR audit_user_id = ${auditUserId})
                ORDER BY last_used_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainScopeModel.toRecord(row));
    }
}

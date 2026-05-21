import type { Database } from "bun:sqlite";
import type { CodenameRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainCodenameModel, type BrainCodenameRow } from "./entity.ts";

/**
 * Repo for `codenames`.
 *
 * Codenames are explicit user/work anchors. This repo only persists counters
 * and bindings; it never infers project intent from names or text.
 */
export class BrainCodenameRepo {
    public constructor(private readonly db: Database) {}

    public upsert(record: CodenameRecord): CodenameRecord {
        runQuery(
            this.db,
            query`INSERT INTO codenames (
                id, name, working_dir, description, user_id,
                created_at, last_used_at, use_count, scope_id
            ) VALUES (
                ${record.id}, ${record.name}, ${record.workingDir ?? null}, ${record.description ?? null},
                ${record.auditUserId ?? record.userId ?? record.id}, ${record.createdAt}, ${record.lastUsedAt},
                ${record.useCount}, ${record.scopeId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                working_dir = excluded.working_dir,
                description = excluded.description,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count,
                scope_id = excluded.scope_id`,
        );
        return record;
    }

    public touch(id: string, ts: number): void {
        runQuery(
            this.db,
            query`UPDATE codenames
                SET last_used_at = ${ts}, use_count = use_count + 1
                WHERE id = ${id}`,
        );
    }

    public bindScope(id: string, scopeId: string): void {
        runQuery(this.db, query`UPDATE codenames SET scope_id = ${scopeId} WHERE id = ${id}`);
    }

    public get(id: string): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(this.db, query`SELECT * FROM codenames WHERE id = ${id}`);
        return row ? brainCodenameModel.toRecord(row) : null;
    }

    public list(input: { limit?: number; userId?: string } = {}): CodenameRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const userId = input.userId ?? null;
        const rows = allQuery<BrainCodenameRow>(
            this.db,
            query`SELECT * FROM codenames
                WHERE (${userId} IS NULL OR user_id = ${userId})
                ORDER BY last_used_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainCodenameModel.toRecord(row));
    }

    public getByName(userId: string, name: string): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(
            this.db,
            query`SELECT * FROM codenames WHERE user_id = ${userId} AND name = ${name}`,
        );
        return row ? brainCodenameModel.toRecord(row) : null;
    }

    public getMostRecentTouched(userId: string, sinceTs: number): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(
            this.db,
            query`SELECT * FROM codenames
                WHERE user_id = ${userId} AND scope_id IS NULL AND last_used_at >= ${sinceTs}
                ORDER BY last_used_at DESC
                LIMIT 1`,
        );
        return row ? brainCodenameModel.toRecord(row) : null;
    }
}

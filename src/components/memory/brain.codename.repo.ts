import type { Database } from "bun:sqlite";
import type { CodenameRecord } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../sql/index.ts";

export interface BrainCodenameRow {
    created_at: number;
    description: string | null;
    id: string;
    last_used_at: number;
    name: string;
    project_id: string | null;
    use_count: number;
    user_id: string;
    working_dir: string | null;
}

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
                created_at, last_used_at, use_count, project_id
            ) VALUES (
                ${record.id}, ${record.name}, ${record.workingDir ?? null}, ${record.description ?? null},
                ${record.userId}, ${record.createdAt}, ${record.lastUsedAt},
                ${record.useCount}, ${record.projectId ?? null}
            )
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                working_dir = excluded.working_dir,
                description = excluded.description,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count,
                project_id = excluded.project_id`,
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

    public bindProject(id: string, projectId: string): void {
        runQuery(this.db, query`UPDATE codenames SET project_id = ${projectId} WHERE id = ${id}`);
    }

    public get(id: string): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(this.db, query`SELECT * FROM codenames WHERE id = ${id}`);
        return row ? this.toRecord(row) : null;
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
        return rows.map((row) => this.toRecord(row));
    }

    public getByName(userId: string, name: string): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(
            this.db,
            query`SELECT * FROM codenames WHERE user_id = ${userId} AND name = ${name}`,
        );
        return row ? this.toRecord(row) : null;
    }

    public getMostRecentTouched(userId: string, sinceTs: number): CodenameRecord | null {
        const row = getQuery<BrainCodenameRow>(
            this.db,
            query`SELECT * FROM codenames
                WHERE user_id = ${userId} AND project_id IS NULL AND last_used_at >= ${sinceTs}
                ORDER BY last_used_at DESC
                LIMIT 1`,
        );
        return row ? this.toRecord(row) : null;
    }

    private toRecord(row: BrainCodenameRow): CodenameRecord {
        return {
            id: row.id,
            name: row.name,
            workingDir: row.working_dir ?? undefined,
            description: row.description ?? undefined,
            userId: row.user_id,
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
            useCount: row.use_count,
            projectId: row.project_id ?? undefined,
        };
    }
}

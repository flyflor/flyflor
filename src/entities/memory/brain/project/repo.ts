import type { Database } from "bun:sqlite";
import type { ProjectRecord } from "../../../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainProjectModel, type BrainProjectRow } from "./entity.ts";

/**
 * Repo for the `projects` model.
 *
 * It owns SQL and row mapping only. Runtime scope decisions remain in context
 * and memory components so this table cannot become an implicit session layer.
 */
export class BrainProjectRepo {
    public constructor(private readonly db: Database) {}

    public upsert(record: ProjectRecord): ProjectRecord {
        runQuery(
            this.db,
            query`INSERT INTO projects (
                id, user_id, title, goal, project_dir, project_memory_dir,
                created_at, updated_at, last_used_at, use_count
            ) VALUES (
                ${record.id}, ${record.userId}, ${record.title}, ${record.goal ?? null},
                ${record.projectDir}, ${record.projectMemoryDir}, ${record.createdAt},
                ${record.updatedAt}, ${record.lastUsedAt}, ${record.useCount}
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                goal = excluded.goal,
                project_dir = excluded.project_dir,
                project_memory_dir = excluded.project_memory_dir,
                updated_at = excluded.updated_at,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count`,
        );
        return record;
    }

    public get(id: string): ProjectRecord | null {
        const row = getQuery<BrainProjectRow>(this.db, query`SELECT * FROM projects WHERE id = ${id}`);
        return row ? brainProjectModel.toRecord(row) : null;
    }

    public list(input: { limit?: number; userId?: string } = {}): ProjectRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
        const userId = input.userId ?? null;
        const rows = allQuery<BrainProjectRow>(
            this.db,
            query`SELECT * FROM projects
                WHERE (${userId} IS NULL OR user_id = ${userId})
                ORDER BY last_used_at DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainProjectModel.toRecord(row));
    }
}

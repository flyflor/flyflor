import type { ScopeRecord } from "../../../../protocol/contracts/index.ts";

export interface BrainScopeRow {
    created_at: number;
    goal: string | null;
    id: string;
    last_used_at: number;
    project_dir: string;
    project_memory_dir: string;
    title: string;
    updated_at: number;
    use_count: number;
}

/**
 * Data model mapper for the `scopes` table.
 *
 * Repo classes own SQL; model classes own row/record shape conversion so the
 * persistence layer does not mix schema mapping with query construction.
 */
export class BrainScopeModel {
    public toRecord(row: BrainScopeRow): ScopeRecord {
        return {
            id: row.id,
            title: row.title,
            goal: row.goal ?? undefined,
            projectDir: row.project_dir,
            projectMemoryDir: row.project_memory_dir,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastUsedAt: row.last_used_at,
            useCount: row.use_count,
        };
    }
}

export const brainScopeModel = new BrainScopeModel();

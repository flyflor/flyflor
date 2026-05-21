import type { CodenameRecord } from "../../../../protocol/contracts/index.ts";

export interface BrainCodenameRow {
    created_at: number;
    description: string | null;
    id: string;
    last_used_at: number;
    name: string;
    scope_id?: string | null;
    project_id?: string | null;
    use_count: number;
    working_dir: string | null;
}

/**
 * Data model mapper for `codenames`.
 */
export class BrainCodenameModel {
    public toRecord(row: BrainCodenameRow): CodenameRecord {
        return {
            id: row.id,
            name: row.name,
            workingDir: row.working_dir ?? undefined,
            description: row.description ?? undefined,
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
            useCount: row.use_count,
            scopeId: row.scope_id ?? row.project_id ?? undefined,
        };
    }
}

export const brainCodenameModel = new BrainCodenameModel();

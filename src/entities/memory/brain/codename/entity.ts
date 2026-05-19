import type { CodenameRecord } from "../../../../protocol/contracts/index.ts";

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
 * Data model mapper for `codenames`.
 */
export class BrainCodenameModel {
    public toRecord(row: BrainCodenameRow): CodenameRecord {
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

export const brainCodenameModel = new BrainCodenameModel();

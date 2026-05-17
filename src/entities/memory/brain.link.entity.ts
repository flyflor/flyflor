import type { MemoryLinkRecord, MemoryLinkType } from "../../protocol/contracts/index.ts";

export interface BrainLinkRow {
    created_at: number;
    from_id: string;
    id: string;
    strength: number;
    to_id: string;
    type: string;
}

/**
 * Data model mapper for `memory_links`.
 */
export class BrainLinkModel {
    public toRecord(row: BrainLinkRow): MemoryLinkRecord {
        return {
            id: row.id,
            fromId: row.from_id,
            toId: row.to_id,
            strength: row.strength,
            type: row.type as MemoryLinkType,
            createdAt: row.created_at,
        };
    }
}

export const brainLinkModel = new BrainLinkModel();

import { type MemoryStateRecord, MemoryEventStatus } from "../../protocol/contracts/index.ts";

export interface BrainStateRow {
    access_count: number;
    activation: number;
    decay_score: number;
    event_id: string;
    last_accessed: number | null;
    resumed_at: number | null;
    status: string;
}

/**
 * Data model mapper for `memory_state`.
 */
export class BrainStateModel {
    public toRecord(row: BrainStateRow): MemoryStateRecord {
        return {
            eventId: row.event_id,
            activation: row.activation,
            decayScore: row.decay_score,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed ?? undefined,
            resumedAt: row.resumed_at ?? undefined,
            status: row.status as MemoryStateRecord["status"],
        };
    }

    public defaultRecord(eventId: string, mutation: Partial<MemoryStateRecord> = {}): MemoryStateRecord {
        return {
            eventId,
            activation: mutation.activation ?? 0,
            decayScore: mutation.decayScore ?? 0,
            accessCount: mutation.accessCount ?? 0,
            lastAccessed: mutation.lastAccessed,
            resumedAt: mutation.resumedAt,
            status: mutation.status ?? MemoryEventStatus.Live,
        };
    }
}

export const brainStateModel = new BrainStateModel();

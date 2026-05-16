import type { Database } from "bun:sqlite";
import { type MemoryStateRecord, MemoryEventStatus } from "../../protocol/contracts/index.ts";
import { getQuery, query, runQuery } from "../sql/index.ts";

export interface BrainStateMutation {
    accessCount?: number;
    activation?: number;
    decayScore?: number;
    lastAccessed?: number;
    resumedAt?: number;
    status?: MemoryStateRecord["status"];
}

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
 * Repo for `memory_state`.
 *
 * This is the mutable layer paired with append-only `memory_events`. Dream,
 * decay and resume flows update state here instead of mutating event rows.
 */
export class BrainStateRepo {
    public constructor(private readonly db: Database) {}

    public get(eventId: string): MemoryStateRecord | null {
        const row = getQuery<BrainStateRow>(this.db, query`SELECT * FROM memory_state WHERE event_id = ${eventId}`);
        return row ? this.toRecord(row) : null;
    }

    public upsert(eventId: string, mutation: BrainStateMutation): MemoryStateRecord {
        const existing = this.get(eventId);
        const next: MemoryStateRecord = {
            eventId,
            activation: mutation.activation ?? existing?.activation ?? 0,
            decayScore: mutation.decayScore ?? existing?.decayScore ?? 0,
            accessCount: mutation.accessCount ?? existing?.accessCount ?? 0,
            lastAccessed: mutation.lastAccessed ?? existing?.lastAccessed,
            resumedAt: mutation.resumedAt ?? existing?.resumedAt,
            status: mutation.status ?? existing?.status ?? MemoryEventStatus.Live,
        };
        runQuery(
            this.db,
            query`INSERT INTO memory_state (
                event_id, activation, decay_score, access_count,
                last_accessed, resumed_at, status
            ) VALUES (
                ${eventId}, ${next.activation}, ${next.decayScore}, ${next.accessCount},
                ${next.lastAccessed ?? null}, ${next.resumedAt ?? null}, ${next.status}
            )
            ON CONFLICT(event_id) DO UPDATE SET
                activation = excluded.activation,
                decay_score = excluded.decay_score,
                access_count = excluded.access_count,
                last_accessed = excluded.last_accessed,
                resumed_at = excluded.resumed_at,
                status = excluded.status`,
        );
        return next;
    }

    private toRecord(row: BrainStateRow): MemoryStateRecord {
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
}

import type { Database } from "bun:sqlite";
import type { EqLabel, EqState } from "../../protocol/contracts/index.ts";
import { getQuery, query, runQuery } from "../sql/index.ts";

export interface BrainEqStateRow {
    arousal: number;
    confidence: number;
    dominance: number;
    label: string;
    updated_at: number;
    user_id: string;
    valence: number;
}

/**
 * Repo for `memory_eq_state`.
 *
 * EQ state is latest-only and tone-facing. It is intentionally kept separate
 * from routing/tool/memory decisions, which are driven by structured protocols.
 */
export class BrainEqStateRepo {
    public constructor(private readonly db: Database) {}

    public upsert(state: EqState): void {
        runQuery(
            this.db,
            query`INSERT INTO memory_eq_state (user_id, valence, arousal, dominance, label, confidence, updated_at)
             VALUES (${state.userId}, ${state.valence}, ${state.arousal}, ${state.dominance}, ${state.label}, ${state.confidence}, ${state.updatedAt})
             ON CONFLICT(user_id) DO UPDATE SET
                valence = excluded.valence,
                arousal = excluded.arousal,
                dominance = excluded.dominance,
                label = excluded.label,
                confidence = excluded.confidence,
                updated_at = excluded.updated_at`,
        );
    }

    public get(userId: string): EqState | null {
        const row = getQuery<BrainEqStateRow>(this.db, query`SELECT * FROM memory_eq_state WHERE user_id = ${userId}`);
        return row ? this.toRecord(row) : null;
    }

    private toRecord(row: BrainEqStateRow): EqState {
        return {
            userId: row.user_id,
            valence: row.valence,
            arousal: row.arousal,
            dominance: row.dominance,
            label: row.label as EqLabel,
            confidence: row.confidence,
            updatedAt: row.updated_at,
        };
    }
}

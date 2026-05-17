import type { EqLabel, EqState } from "../../protocol/contracts/index.ts";

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
 * Data model mapper for `memory_eq_state`.
 */
export class BrainEqStateModel {
    public toRecord(row: BrainEqStateRow): EqState {
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

export const brainEqStateModel = new BrainEqStateModel();

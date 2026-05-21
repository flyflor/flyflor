import type { EqLabel, EqState } from "../../../../protocol/contracts/index.ts";

export interface BrainEqStateRow {
    arousal: number;
    confidence: number;
    dominance: number;
    label: string;
    updated_at: number;
    owner_key?: string | null;
    source_key?: string | null;
    legacy_source_key?: string | null;
    valence: number;
}

/**
 * Data model mapper for `memory_eq_state`.
 */
export class BrainEqStateModel {
    public toRecord(row: BrainEqStateRow): EqState {
        return {
            ownerKey: row.owner_key ?? row.legacy_source_key ?? "eq:unknown",
            sourceKey: row.source_key ?? row.legacy_source_key ?? undefined,
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

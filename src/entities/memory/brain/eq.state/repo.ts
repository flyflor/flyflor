import type { Database } from "bun:sqlite";
import type { EqState } from "../../../../protocol/contracts/index.ts";
import { query, runQuery } from "../../../../components/sql/index.ts";
import { brainEqStateModel, type BrainEqStateRow } from "./entity.ts";

/**
 * Repo for `memory_eq_state`.
 *
 * EQ state is latest-only and tone-facing. It is intentionally kept separate
 * from routing/tool/memory decisions, which are driven by structured protocols.
 */
export class BrainEqStateRepo {
    public constructor(private readonly db: Database) {}

    public upsert(state: EqState): void {
        const sourceKey = state.sourceKey ?? state.ownerKey;
        runQuery(
            this.db,
            query`INSERT INTO memory_eq_state (owner_key, source_key, valence, arousal, dominance, label, confidence, updated_at)
             VALUES (${state.ownerKey}, ${sourceKey}, ${state.valence}, ${state.arousal}, ${state.dominance}, ${state.label}, ${state.confidence}, ${state.updatedAt})
             ON CONFLICT(owner_key) DO UPDATE SET
                source_key = excluded.source_key,
                valence = excluded.valence,
                arousal = excluded.arousal,
                dominance = excluded.dominance,
                label = excluded.label,
                confidence = excluded.confidence,
                updated_at = excluded.updated_at`,
        );
    }

    public get(ownerKey: string): EqState | null {
        const row = this.db
            .query<BrainEqStateRow, [string]>(`SELECT ${this.selectProjection()} FROM memory_eq_state WHERE owner_key = ?1`)
            .get(ownerKey);
        return row ? brainEqStateModel.toRecord(row) : null;
    }

    private selectProjection(): string {
        const legacySourceColumn = this.hasColumn("memory_eq_state", "legacy_source_key") ? "legacy_source_key" : "source_key AS legacy_source_key";
        return [
            "arousal",
            "confidence",
            "dominance",
            "label",
            "updated_at",
            "owner_key",
            "source_key",
            legacySourceColumn,
            "valence",
        ].join(", ");
    }

    private hasColumn(table: string, column: string): boolean {
        return this.db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    }
}

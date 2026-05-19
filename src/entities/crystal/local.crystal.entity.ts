import type { CrystalGem } from "../../protocol/contracts/index.ts";

export interface CrystalGemRow {
    bucket: string;
    confidence: number;
    coordinates_json: string;
    created_at: string;
    embedding_json: string;
    evidence_score: number;
    id: string;
    metadata_json?: string;
    method: string;
    searchable_text: string;
    source_atom_ids_json: string;
    support: number;
    symbols_json: string;
    title: string;
    updated_at: string;
}

/**
 * Data model for the local crystal SQLite backend.
 *
 * The repo owns SQL. This model owns JSON column hydration so malformed rows
 * fail at the storage boundary instead of drifting into runtime reflection.
 */
export class LocalCrystalModel {
    public rowToGem(row: CrystalGemRow): CrystalGem {
        return {
            id: row.id,
            bucket: row.bucket,
            title: row.title,
            method: row.method,
            symbols: this.parseJsonArray(row.symbols_json, `crystal_gems.symbols_json for ${row.id}`),
            coordinates: this.parseJsonNumberRecord(row.coordinates_json, `crystal_gems.coordinates_json for ${row.id}`),
            confidence: row.confidence,
            support: row.support,
            evidenceScore: row.evidence_score,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceAtomIds: this.parseJsonArray(row.source_atom_ids_json, `crystal_gems.source_atom_ids_json for ${row.id}`),
            metadata: this.parseJsonRecord(row.metadata_json, `crystal_gems.metadata_json for ${row.id}`),
        };
    }

    private parseJsonArray(value: string, field: string): string[] {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error(`${field} must be a JSON array.`);
        }
        return parsed.filter((item): item is string => typeof item === "string");
    }

    private parseJsonNumberRecord(value: string, field: string): Record<string, number> {
        const parsed = JSON.parse(value) as unknown;
        if (!this.isRecord(parsed)) {
            throw new Error(`${field} must be a JSON object.`);
        }
        if (Object.values(parsed).some((item) => typeof item !== "number" || !Number.isFinite(item))) {
            throw new Error(`${field} must contain only finite numbers.`);
        }
        const out: Record<string, number> = {};
        for (const [key, item] of Object.entries(parsed)) {
            out[key] = item as number;
        }
        return out;
    }

    private parseJsonRecord(value: string | undefined, field: string): Record<string, unknown> | undefined {
        if (!value) {
            return undefined;
        }
        const parsed = JSON.parse(value) as unknown;
        if (!this.isRecord(parsed)) {
            throw new Error(`${field} must be a JSON object.`);
        }
        return parsed;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

export const localCrystalModel = new LocalCrystalModel();

import type { Database } from "bun:sqlite";
import type { CrystalGem, ReflectionAtom, ReflectionCandidate } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../components/sql/index.ts";
import { localCrystalModel, type CrystalGemRow } from "./local.crystal.entity.ts";

/**
 * SQL repo for the local crystal backend.
 *
 * Store owns lifecycle/schema and vector index hydration; this repo owns all
 * SQL for candidate, atom and gem persistence.
 */
export class LocalCrystalRepo {
    public constructor(private readonly db: Database) {}

    public findGem(id: string): CrystalGem | undefined {
        const row = getQuery<CrystalGemRow>(
            this.db,
            query`SELECT * FROM crystal_gems WHERE id = ${id} LIMIT 1`,
        );
        return row ? localCrystalModel.rowToGem(row) : undefined;
    }

    public listGems(): CrystalGem[] {
        return allQuery<CrystalGemRow>(
            this.db,
            query`SELECT * FROM crystal_gems ORDER BY updated_at DESC`,
        ).map((row) => localCrystalModel.rowToGem(row));
    }

    public deleteGem(id: string): boolean {
        const statement = query`DELETE FROM crystal_gems WHERE id = ${id}`;
        const result = this.db.query(statement.sql).run(...statement.params);
        return (result.changes ?? 0) > 0;
    }

    public upsertCandidate(candidate: ReflectionCandidate): void {
        runQuery(
            this.db,
            query`INSERT OR REPLACE INTO crystal_candidates (
                id, source_id, source_kind, content, bucket, symbols_json, coordinates_json,
                evidence_json, created_at, metadata_json
            ) VALUES (
                ${candidate.id}, ${candidate.sourceId}, ${candidate.sourceKind}, ${candidate.content},
                ${candidate.bucket}, ${JSON.stringify(candidate.symbols)}, ${JSON.stringify(candidate.coordinates)},
                ${JSON.stringify(candidate.evidence)}, ${candidate.createdAt}, ${JSON.stringify(candidate.metadata ?? {})}
            )`,
        );
    }

    public upsertAtom(atom: ReflectionAtom): void {
        runQuery(
            this.db,
            query`INSERT OR REPLACE INTO crystal_atoms (
                id, candidate_id, bucket, content, symbols_json, coordinates_json,
                evidence_score, confidence, created_at, metadata_json
            ) VALUES (
                ${atom.id}, ${atom.candidateId}, ${atom.bucket}, ${atom.content},
                ${JSON.stringify(atom.symbols)}, ${JSON.stringify(atom.coordinates)}, ${atom.evidenceScore},
                ${atom.confidence}, ${atom.createdAt}, ${JSON.stringify(atom.metadata ?? {})}
            )`,
        );
    }

    public upsertGem(gem: CrystalGem, embedding: number[], searchableText: string): void {
        runQuery(
            this.db,
            query`INSERT OR REPLACE INTO crystal_gems (
                id, bucket, title, method, symbols_json, coordinates_json, confidence, support,
                evidence_score, created_at, updated_at, source_atom_ids_json, metadata_json,
                embedding_json, searchable_text
            ) VALUES (
                ${gem.id}, ${gem.bucket}, ${gem.title}, ${gem.method}, ${JSON.stringify(gem.symbols)},
                ${JSON.stringify(gem.coordinates)}, ${gem.confidence}, ${gem.support}, ${gem.evidenceScore},
                ${gem.createdAt}, ${gem.updatedAt}, ${JSON.stringify(gem.sourceAtomIds)},
                ${JSON.stringify(gem.metadata ?? {})}, ${JSON.stringify(embedding)}, ${searchableText}
            )`,
        );
    }
}

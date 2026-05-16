import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { LocalCrystalMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { CrystalComponent } from "../core.ts";
import type {
    CrystalRecallRequest,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../protocol/contracts/index.ts";
import type { CrystalMemoryStore } from "../../crystal/memory/types.ts";
import {
    DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    FlatBruteForceVectorIndex,
    embedCrystalText,
    toCrystalSearchText,
} from "../../crystal/memory/vector.index.ts";

interface CrystalGemRow {
    id: string;
    bucket: string;
    title: string;
    method: string;
    symbols_json: string;
    coordinates_json: string;
    confidence: number;
    support: number;
    evidence_score: number;
    created_at: string;
    updated_at: string;
    source_atom_ids_json: string;
    metadata_json?: string;
    embedding_json: string;
    searchable_text: string;
}

@Component({ name: "local-crystal-memory-store", tags: ["database", "crystal", "local"] })
export class LocalCrystalMemoryStore extends CrystalComponent implements CrystalMemoryStore {
    private database?: Database;
    private readonly index: FlatBruteForceVectorIndex;
    private readonly vectorDimensions: number;

    public constructor(
        private readonly config: LocalCrystalMemoryConfig,
        vectorDimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    ) {
        super();
        this.vectorDimensions = vectorDimensions;
        this.index = new FlatBruteForceVectorIndex(vectorDimensions);
    }

    public async initialize(): Promise<void> {
        if (this.database) {
            return;
        }
        const dbFile = this.requiredDbFile();
        await mkdir(dirname(dbFile), { recursive: true });
        const database = new Database(dbFile, { create: true });
        database.exec(`
            CREATE TABLE IF NOT EXISTS crystal_candidates (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                content TEXT NOT NULL,
                bucket TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                coordinates_json TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS crystal_atoms (
                id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                bucket TEXT NOT NULL,
                content TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                coordinates_json TEXT NOT NULL,
                evidence_score REAL NOT NULL,
                confidence REAL NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS crystal_gems (
                id TEXT PRIMARY KEY,
                bucket TEXT NOT NULL,
                title TEXT NOT NULL,
                method TEXT NOT NULL,
                symbols_json TEXT NOT NULL,
                coordinates_json TEXT NOT NULL,
                confidence REAL NOT NULL,
                support INTEGER NOT NULL,
                evidence_score REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_atom_ids_json TEXT NOT NULL,
                metadata_json TEXT,
                embedding_json TEXT NOT NULL,
                searchable_text TEXT NOT NULL
            );
        `);
        database.exec("CREATE INDEX IF NOT EXISTS idx_crystal_candidates_bucket ON crystal_candidates(bucket)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_crystal_atoms_bucket ON crystal_atoms(bucket)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_crystal_gems_bucket ON crystal_gems(bucket)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_crystal_gems_updated_at ON crystal_gems(updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_crystal_gems_support ON crystal_gems(support DESC)");
        this.database = database;
        this.index.hydrate(this.loadGemsFromDatabase());
    }

    public async findGem(id: string): Promise<CrystalGem | undefined> {
        await this.initialize();
        const cached = this.index.find(id);
        if (cached) {
            return cached;
        }
        const row = this.requiredDatabase()
            .query("SELECT * FROM crystal_gems WHERE id = ? LIMIT 1")
            .get(id) as CrystalGemRow | null;
        if (!row) {
            return undefined;
        }
        const gem = rowToGem(row);
        this.index.upsert(gem);
        return gem;
    }

    public async listGems(request: CrystalRecallRequest): Promise<CrystalGem[]> {
        await this.initialize();
        return this.index.search(request, Math.max(1, Math.min(request.limit * 8, 128)));
    }

    public async upsertCandidate(candidate: ReflectionCandidate): Promise<void> {
        await this.initialize();
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO crystal_candidates (
                    id, source_id, source_kind, content, bucket, symbols_json, coordinates_json,
                    evidence_json, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                candidate.id,
                candidate.sourceId,
                candidate.sourceKind,
                candidate.content,
                candidate.bucket,
                JSON.stringify(candidate.symbols),
                JSON.stringify(candidate.coordinates),
                JSON.stringify(candidate.evidence),
                candidate.createdAt,
                JSON.stringify(candidate.metadata ?? {}),
            );
    }

    public async upsertAtom(atom: ReflectionAtom): Promise<void> {
        await this.initialize();
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO crystal_atoms (
                    id, candidate_id, bucket, content, symbols_json, coordinates_json,
                    evidence_score, confidence, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                atom.id,
                atom.candidateId,
                atom.bucket,
                atom.content,
                JSON.stringify(atom.symbols),
                JSON.stringify(atom.coordinates),
                atom.evidenceScore,
                atom.confidence,
                atom.createdAt,
                JSON.stringify(atom.metadata ?? {}),
            );
    }

    public async upsertGem(gem: CrystalGem): Promise<void> {
        await this.initialize();
        const searchableText = toCrystalSearchText(gem);
        const embedding = embedCrystalText(searchableText, this.vectorDimensions);
        this.requiredDatabase()
            .query(
                `
                INSERT OR REPLACE INTO crystal_gems (
                    id, bucket, title, method, symbols_json, coordinates_json, confidence, support,
                    evidence_score, created_at, updated_at, source_atom_ids_json, metadata_json,
                    embedding_json, searchable_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                gem.id,
                gem.bucket,
                gem.title,
                gem.method,
                JSON.stringify(gem.symbols),
                JSON.stringify(gem.coordinates),
                gem.confidence,
                gem.support,
                gem.evidenceScore,
                gem.createdAt,
                gem.updatedAt,
                JSON.stringify(gem.sourceAtomIds),
                JSON.stringify(gem.metadata ?? {}),
                JSON.stringify(embedding),
                searchableText,
            );
        this.index.upsert(gem);
    }

    private loadGemsFromDatabase(): CrystalGem[] {
        if (!this.database) {
            return [];
        }
        const rows = this.database.query("SELECT * FROM crystal_gems ORDER BY updated_at DESC").all() as CrystalGemRow[];
        return rows.map(rowToGem);
    }

    private requiredDatabase(): Database {
        if (!this.database) {
            throw new Error("LocalCrystalMemoryStore is not initialized.");
        }
        return this.database;
    }

    private requiredDbFile(): string {
        if (!this.config.dbFile) {
            throw new Error("memory.crystal.local.dbFile is required for the local crystal backend.");
        }
        return this.config.dbFile;
    }
}

function rowToGem(row: CrystalGemRow): CrystalGem {
    return {
        id: row.id,
        bucket: row.bucket,
        title: row.title,
        method: row.method,
        symbols: parseJsonArray(row.symbols_json),
        coordinates: parseJsonNumberRecord(row.coordinates_json),
        confidence: row.confidence,
        support: row.support,
        evidenceScore: row.evidence_score,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sourceAtomIds: parseJsonArray(row.source_atom_ids_json),
        metadata: parseJsonRecord(row.metadata_json),
    };
}

function parseJsonArray(value: string): string[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonNumberRecord(value: string): Record<string, number> {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
        return {};
    }
    const out: Record<string, number> = {};
    for (const [key, item] of Object.entries(parsed)) {
        if (typeof item === "number" && Number.isFinite(item)) {
            out[key] = item;
        }
    }
    return out;
}

function parseJsonRecord(value?: string): Record<string, unknown> | undefined {
    if (!value) {
        return undefined;
    }
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

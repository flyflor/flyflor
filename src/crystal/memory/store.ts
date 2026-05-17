import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { LocalCrystalMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { CrystalComponent } from "../../components/component.ts";
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
import { LocalCrystalRepo } from "../../entities/crystal/local.crystal.repo.ts";

@Component()
export class LocalCrystalMemoryStore extends CrystalComponent implements CrystalMemoryStore {
    private database?: Database;
    private readonly index: FlatBruteForceVectorIndex;
    private repo?: LocalCrystalRepo;
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
        this.repo = new LocalCrystalRepo(database);
        this.index.hydrate(this.repo.listGems());
    }

    public async findGem(id: string): Promise<CrystalGem | undefined> {
        await this.initialize();
        const cached = this.index.find(id);
        if (cached) {
            return cached;
        }
        const gem = this.requiredRepo().findGem(id);
        if (!gem) {
            return undefined;
        }
        this.index.upsert(gem);
        return gem;
    }

    public async listGems(request: CrystalRecallRequest): Promise<CrystalGem[]> {
        await this.initialize();
        return this.index.search(request, Math.max(1, Math.min(request.limit * 8, 128)));
    }

    public async upsertCandidate(candidate: ReflectionCandidate): Promise<void> {
        await this.initialize();
        this.requiredRepo().upsertCandidate(candidate);
    }

    public async upsertAtom(atom: ReflectionAtom): Promise<void> {
        await this.initialize();
        this.requiredRepo().upsertAtom(atom);
    }

    public async upsertGem(gem: CrystalGem): Promise<void> {
        await this.initialize();
        const searchableText = toCrystalSearchText(gem);
        const embedding = embedCrystalText(searchableText, this.vectorDimensions);
        this.requiredRepo().upsertGem(gem, embedding, searchableText);
        this.index.upsert(gem);
    }

    private requiredRepo(): LocalCrystalRepo {
        if (!this.repo) {
            throw new Error("LocalCrystalMemoryStore repo is not initialized.");
        }
        return this.repo;
    }

    private requiredDbFile(): string {
        if (!this.config.dbFile) {
            throw new Error("memory.crystal.local.dbFile is required for the local crystal backend.");
        }
        return this.config.dbFile;
    }
}

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths, SQLiteMemoryConfig } from "../../../../config/index.ts";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { SQLiteComponent } from "../../../../components/component.ts";
import { getQuery, query } from "../../../../components/sql/index.ts";
import type {
    MemoryCandidate,
    MemoryRecord,
    MemorySearchRequest,
    MemorySearchResult,
} from "../types.ts";
import { SQLiteMemoryRepo, type PendingProjectOffer, type PendingSkillOffer } from "../../../../entities/memory/index.ts";

export type { PendingProjectOffer, PendingSkillOffer } from "../../../../entities/memory/index.ts";

/**
 * SQLite memory store.
 *
 * Store lifecycle/schema is kept here. Runtime SQL is delegated to
 * `SQLiteMemoryRepo`; row mapping and scoring live in `SQLiteMemoryModel`.
 */
@Component()
export class SQLiteMemoryStore extends SQLiteComponent {
    private database?: Database;
    private repo?: SQLiteMemoryRepo;

    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: SQLiteMemoryConfig,
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        if (!this.config.enabled || this.database) {
            return;
        }

        await mkdir(this.paths.memoryDir, { recursive: true });
        let database = this.openMemoryDatabase(join(this.paths.memoryDir, "memory.sqlite"));
        if (this.hasIncompatibleMemorySchema(database)) {
            database.close();
            database = this.openMemoryDatabase(join(this.paths.memoryDir, "memory.project.sqlite"));
        }
        this.installSchema(database);
        this.database = database;
        this.repo = new SQLiteMemoryRepo(database, this.config);
    }

    public async addCandidate(candidate: MemoryCandidate): Promise<void> {
        await this.initialize();
        this.repo?.addCandidate(candidate);
    }

    public async markCandidatePromoted(candidateId: string, promotedAt: string): Promise<void> {
        await this.initialize();
        this.repo?.markCandidatePromoted(candidateId, promotedAt);
    }

    public async addSearchRecord(record: MemoryRecord): Promise<void> {
        await this.initialize();
        this.repo?.addSearchRecord(record);
    }

    public async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        await this.initialize();
        return this.repo?.search(request) ?? [];
    }

    /** Persists one pending explicit project offer per user. */
    public async upsertProjectOffer(offer: PendingProjectOffer): Promise<void> {
        await this.initialize();
        this.repo?.upsertProjectOffer(offer);
    }

    public async getProjectOffer(userId: string): Promise<PendingProjectOffer | undefined> {
        await this.initialize();
        return this.repo?.getProjectOffer(userId);
    }

    public async decrementProjectOfferTtl(userId: string): Promise<number | undefined> {
        await this.initialize();
        return this.repo?.decrementProjectOfferTtl(userId);
    }

    public async deleteProjectOffer(userId: string): Promise<void> {
        await this.initialize();
        this.repo?.deleteProjectOffer(userId);
    }

    /** Persists one pending explicit skill/gem offer per user. */
    public async upsertSkillOffer(offer: PendingSkillOffer): Promise<void> {
        await this.initialize();
        this.repo?.upsertSkillOffer(offer);
    }

    public async getSkillOffer(userId: string): Promise<PendingSkillOffer | undefined> {
        await this.initialize();
        return this.repo?.getSkillOffer(userId);
    }

    public async decrementSkillOfferTtl(userId: string): Promise<number | undefined> {
        await this.initialize();
        return this.repo?.decrementSkillOfferTtl(userId);
    }

    public async deleteSkillOffer(userId: string): Promise<void> {
        await this.initialize();
        this.repo?.deleteSkillOffer(userId);
    }

    private openMemoryDatabase(path: string): Database {
        const database = new Database(path);
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        return database;
    }

    private installSchema(database: Database): void {
        database.exec(`
            CREATE TABLE IF NOT EXISTS memory_candidates (
                id TEXT PRIMARY KEY,
                target_file TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                content TEXT NOT NULL,
                project_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_message_id TEXT,
                source_reply_id TEXT,
                created_at TEXT NOT NULL,
                promoted_at TEXT,
                weights_json TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                content TEXT NOT NULL,
                scope TEXT NOT NULL,
                subject_id TEXT,
                channel TEXT,
                chat_id TEXT,
                importance REAL NOT NULL DEFAULT 0.5,
                confidence REAL NOT NULL DEFAULT 1.0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                id UNINDEXED,
                content,
                tokenize = 'unicode61'
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS pending_project_offer (
                user_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                trigger_kind TEXT NOT NULL,
                evidence_score REAL NOT NULL,
                related_ids_json TEXT NOT NULL,
                proposed_at TEXT NOT NULL,
                ttl_turns INTEGER NOT NULL
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS pending_skill_offer (
                user_id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                summary TEXT NOT NULL,
                support INTEGER NOT NULL,
                confidence REAL NOT NULL,
                mcp_tools_json TEXT NOT NULL,
                related_ids_json TEXT NOT NULL,
                proposed_at TEXT NOT NULL,
                ttl_turns INTEGER NOT NULL
            );
        `);
        database.exec("CREATE INDEX IF NOT EXISTS idx_candidates_status ON memory_candidates(status, created_at)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_scope_updated ON memories(scope, updated_at DESC)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(subject_id, updated_at DESC)");
    }

    private hasIncompatibleMemorySchema(database: Database): boolean {
        return this.tableExists(database, "memory_candidates") && !this.tableHasColumn(database, "memory_candidates", "source_id");
    }

    private tableExists(database: Database, table: string): boolean {
        const row = getQuery<{ name: string }>(
            database,
            query`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
        );
        return Boolean(row);
    }

    private tableHasColumn(database: Database, table: string, column: string): boolean {
        this.assertKnownMemoryTable(table);
        const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return rows.some((row) => row.name === column);
    }

    private assertKnownMemoryTable(table: string): void {
        if (table !== "memory_candidates") {
            throw new Error(`Unknown memory table: ${table}`);
        }
    }
}

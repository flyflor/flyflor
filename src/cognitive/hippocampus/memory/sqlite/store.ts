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
import { SQLiteMemoryRepo, type PendingScopeOffer, type PendingSkillOffer } from "../../../../entities/memory/index.ts";

export type { PendingScopeOffer, PendingSkillOffer } from "../../../../entities/memory/index.ts";

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
        const database = this.openMemoryDatabase(join(this.paths.memoryDir, "memory.sqlite"));
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

    /** Persists one pending explicit scope offer per continuity owner. */
    public async upsertScopeOffer(offer: PendingScopeOffer): Promise<void> {
        await this.initialize();
        this.repo?.upsertScopeOffer(offer);
    }

    public async getScopeOffer(ownerKey: string): Promise<PendingScopeOffer | undefined> {
        await this.initialize();
        return this.repo?.getScopeOffer(ownerKey);
    }

    public async decrementScopeOfferTtl(ownerKey: string): Promise<number | undefined> {
        await this.initialize();
        return this.repo?.decrementScopeOfferTtl(ownerKey);
    }

    public async deleteScopeOffer(ownerKey: string): Promise<void> {
        await this.initialize();
        this.repo?.deleteScopeOffer(ownerKey);
    }

    /** Persists one pending explicit skill/gem offer per continuity owner. */
    public async upsertSkillOffer(offer: PendingSkillOffer): Promise<void> {
        await this.initialize();
        this.repo?.upsertSkillOffer(offer);
    }

    public async getSkillOffer(ownerKey: string): Promise<PendingSkillOffer | undefined> {
        await this.initialize();
        return this.repo?.getSkillOffer(ownerKey);
    }

    public async decrementSkillOfferTtl(ownerKey: string): Promise<number | undefined> {
        await this.initialize();
        return this.repo?.decrementSkillOfferTtl(ownerKey);
    }

    public async deleteSkillOffer(ownerKey: string): Promise<void> {
        await this.initialize();
        this.repo?.deleteSkillOffer(ownerKey);
    }

    private openMemoryDatabase(path: string): Database {
        const database = new Database(path);
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        return database;
    }

    private installSchema(database: Database): void {
        this.resetLegacyMemoryTables(database);
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
            CREATE TABLE IF NOT EXISTS pending_scope_offer (
                owner_key TEXT PRIMARY KEY,
                scope_id TEXT NOT NULL,
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
                owner_key TEXT PRIMARY KEY,
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

    private tableExists(database: Database, table: string): boolean {
        const row = getQuery<{ name: string }>(
            database,
            query`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
        );
        return Boolean(row);
    }

    private tableColumns(database: Database, table: string): string[] {
        this.assertKnownMemoryTable(table);
        return (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
    }

    /**
     * Old memory.sqlite rows are release-preseal data. Keep the file path, but
     * drop legacy table shapes instead of translating user_id/project_id rows.
     */
    private resetLegacyMemoryTables(database: Database): void {
        if (!this.hasLegacyMemorySchema(database)) return;
        for (const table of [
            "memory_candidates",
            "memories",
            "memories_fts",
            "pending_scope_offer",
            "pending_project_offer",
            "pending_skill_offer",
        ]) {
            database.exec(`DROP TABLE IF EXISTS ${table};`);
        }
    }

    private hasLegacyMemorySchema(database: Database): boolean {
        if (this.tableExists(database, "pending_project_offer")) return true;
        if (this.hasLegacyColumns(database, "memory_candidates", [
            "id",
            "target_file",
            "kind",
            "status",
            "source_kind",
            "content",
            "project_id",
            "source_id",
            "source_message_id",
            "source_reply_id",
            "created_at",
            "promoted_at",
            "weights_json",
            "metadata_json",
        ])) return true;
        if (this.hasLegacyColumns(database, "memories", [
            "id",
            "kind",
            "content",
            "scope",
            "subject_id",
            "importance",
            "confidence",
            "created_at",
            "updated_at",
            "metadata_json",
        ])) return true;
        if (this.hasLegacyColumns(database, "pending_scope_offer", [
            "owner_key",
            "scope_id",
            "title",
            "goal",
            "trigger_kind",
            "evidence_score",
            "related_ids_json",
            "proposed_at",
            "ttl_turns",
        ])) return true;
        return this.hasLegacyColumns(database, "pending_skill_offer", [
            "owner_key",
            "skill_id",
            "name",
            "description",
            "summary",
            "support",
            "confidence",
            "mcp_tools_json",
            "related_ids_json",
            "proposed_at",
            "ttl_turns",
        ]);
    }

    private hasLegacyColumns(database: Database, table: string, canonicalColumns: string[]): boolean {
        if (!this.tableExists(database, table)) return false;
        const columns = this.tableColumns(database, table);
        if (["user_id", "project_id"].some((name) => columns.includes(name) && !canonicalColumns.includes(name))) {
            return true;
        }
        return canonicalColumns.some((name) => !columns.includes(name));
    }

    private assertKnownMemoryTable(table: string): void {
        if (
            table !== "memory_candidates" &&
            table !== "memories" &&
            table !== "pending_scope_offer" &&
            table !== "pending_project_offer" &&
            table !== "pending_skill_offer"
        ) {
            throw new Error(`Unknown memory table: ${table}`);
        }
    }
}

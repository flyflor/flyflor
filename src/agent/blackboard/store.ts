import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths } from "../../config/index.ts";
import { getQuery, query } from "../../components/sql/index.ts";
import { Component } from "../di/decorators/index.ts";
import { BlackboardRepo } from "../../entities/blackboard/index.ts";
import type {
    BlackboardDecision,
    BlackboardDecisionInput,
    BlackboardLease,
    BlackboardLeaseAcquireRequest,
    BlackboardLeaseAcquireResult,
    BlackboardMessage,
    BlackboardMessageInput,
    BlackboardStep,
    BlackboardStepInput,
    BlackboardStore,
    BlackboardTurn,
} from "./types.ts";

/**
 * SQLite-backed blackboard store.
 *
 * The store owns database lifecycle and schema installation only. Runtime SQL
 * lives in `BlackboardRepo`; row hydration lives in `BlackboardModel`.
 */
@Component()
export class SQLiteBlackboardStore implements BlackboardStore {
    private database?: Database;
    private repo?: BlackboardRepo;

    public constructor(private readonly paths: FlyflorPaths) {}

    public async initialize(): Promise<void> {
        if (this.database && this.repo) {
            return;
        }

        const dir = join(this.paths.configDir, "brain", "live");
        await mkdir(dir, { recursive: true });
        let database = this.openBlackboardDatabase(join(dir, "brain.db"));
        if (this.hasIncompatibleBlackboardSchema(database)) {
            database.close();
            database = this.openBlackboardDatabase(join(dir, "brain.compat.blackboard.db"));
        }
        this.installSchema(database);
        this.database = database;
        this.repo = new BlackboardRepo(database);
    }

    public async acquireLease(request: BlackboardLeaseAcquireRequest): Promise<BlackboardLeaseAcquireResult> {
        await this.initialize();
        return this.requiredRepo().acquireLease(request);
    }

    public async releaseLease(projectConstraintId: string, turnId: string, _now: string): Promise<BlackboardLease | undefined> {
        await this.initialize();
        return this.requiredRepo().releaseLease(projectConstraintId, turnId);
    }

    public async createTurn(turn: BlackboardTurn): Promise<void> {
        await this.initialize();
        this.requiredRepo().createTurn(turn);
    }

    public async appendStep(turnId: string, input: BlackboardStepInput): Promise<BlackboardStep> {
        await this.initialize();
        return this.requiredRepo().appendStep(turnId, input);
    }

    public async appendMessage(turnId: string, input: BlackboardMessageInput): Promise<BlackboardMessage> {
        await this.initialize();
        return this.requiredRepo().appendMessage(turnId, input);
    }

    public async appendDecision(turnId: string, input: BlackboardDecisionInput): Promise<BlackboardDecision> {
        await this.initialize();
        return this.requiredRepo().appendDecision(turnId, input);
    }

    public async updateTurnStatus(
        turnId: string,
        status: BlackboardTurn["status"],
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        await this.initialize();
        return this.requiredRepo().updateTurnStatus(turnId, status, now);
    }

    public async getTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        await this.initialize();
        return this.requiredRepo().getTurn(turnId);
    }

    public async listTurns(projectConstraintId: string, limit: number): Promise<BlackboardTurn[]> {
        await this.initialize();
        return this.requiredRepo().listTurns(projectConstraintId, limit);
    }

    public async listRecentTurns(limit: number): Promise<BlackboardTurn[]> {
        await this.initialize();
        return this.requiredRepo().listRecentTurns(limit);
    }

    private requiredRepo(): BlackboardRepo {
        if (!this.repo) {
            throw new Error("Blackboard store is not initialized.");
        }
        return this.repo;
    }

    private openBlackboardDatabase(path: string): Database {
        const database = new Database(path);
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        return database;
    }

    private installSchema(database: Database): void {
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_turns (
                id TEXT PRIMARY KEY,
                project_constraint_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                goal TEXT NOT NULL,
                budget_json TEXT NOT NULL,
                workers_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_messages (
                id TEXT PRIMARY KEY,
                turn_id TEXT NOT NULL REFERENCES blackboard_turns(id) ON DELETE CASCADE,
                round INTEGER,
                worker_role TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                visibility TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_steps (
                id TEXT PRIMARY KEY,
                turn_id TEXT NOT NULL REFERENCES blackboard_turns(id) ON DELETE CASCADE,
                round INTEGER NOT NULL,
                worker_role TEXT NOT NULL,
                input_summary TEXT NOT NULL,
                output_summary TEXT NOT NULL,
                new_facts_json TEXT NOT NULL,
                blockers_json TEXT NOT NULL,
                risk TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_decisions (
                id TEXT PRIMARY KEY,
                turn_id TEXT NOT NULL REFERENCES blackboard_turns(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                prompt TEXT NOT NULL,
                options_json TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL,
                metadata_json TEXT
            );
        `);
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_leases (
                project_constraint_id TEXT PRIMARY KEY,
                turn_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                acquired_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
        `);
        database.exec(
            "CREATE INDEX IF NOT EXISTS idx_blackboard_turns_project_constraint ON blackboard_turns(project_constraint_id, updated_at DESC)",
        );
        database.exec(
            "CREATE INDEX IF NOT EXISTS idx_blackboard_messages_turn ON blackboard_messages(turn_id, created_at)",
        );
        database.exec(
            "CREATE INDEX IF NOT EXISTS idx_blackboard_steps_turn ON blackboard_steps(turn_id, round, created_at)",
        );
        database.exec(
            "CREATE INDEX IF NOT EXISTS idx_blackboard_decisions_turn ON blackboard_decisions(turn_id, created_at)",
        );
    }

    private hasIncompatibleBlackboardSchema(database: Database): boolean {
        return (
            (this.tableExists(database, "blackboard_turns") &&
                !this.tableHasColumn(database, "blackboard_turns", "project_constraint_id")) ||
            (this.tableExists(database, "blackboard_leases") &&
                !this.tableHasColumn(database, "blackboard_leases", "project_constraint_id"))
        );
    }

    private tableExists(database: Database, table: string): boolean {
        const row = getQuery<{ name: string }>(
            database,
            query`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
        );
        return Boolean(row);
    }

    private tableHasColumn(database: Database, table: string, column: string): boolean {
        this.assertKnownBlackboardTable(table);
        const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return rows.some((row) => row.name === column);
    }

    private assertKnownBlackboardTable(table: string): void {
        if (table !== "blackboard_turns" && table !== "blackboard_leases") {
            throw new Error(`Unknown blackboard table: ${table}`);
        }
    }
}

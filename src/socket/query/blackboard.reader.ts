import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getQuery, query } from "../../components/sql/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import { BlackboardRepo } from "../../entities/blackboard/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/types.ts";
import type { SocketQueryBlackboardInput } from "./types.ts";

/**
 * Direct blackboard DB reader for socket queries.
 *
 * The blackboard runtime remains untouched; this reader only hydrates persisted
 * turn rows for TUI inspection and history detail expansion.
 */
export class SocketBlackboardReader {
    private database?: Database;
    private repo?: BlackboardRepo;

    public constructor(private readonly paths: FlyflorPaths) {}

    public async initialize(): Promise<void> {
        if (this.database && this.repo) return;
        const dir = join(this.paths.configDir, "brain", "live");
        await mkdir(dir, { recursive: true });
        const dbPath = this.resolveDbPath(dir);
        const database = new Database(dbPath);
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        installSchema(database);
        this.database = database;
        this.repo = new BlackboardRepo(database);
    }

    public dispose(): void {
        this.database?.close();
        this.database = undefined;
        this.repo = undefined;
    }

    public async getTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        await this.initialize();
        return this.requiredRepo().getTurn(turnId);
    }

    public async listTurns(input: SocketQueryBlackboardInput): Promise<BlackboardTurn[]> {
        await this.initialize();
        const turns = input.scopeId
            ? this.requiredRepo().listTurns(input.scopeId, boundedLimit(input.limit))
            : this.requiredRepo().listRecentTurns(boundedLimit(input.limit));
        return turns.filter((turn) => matchesBlackboardStatus(turn, input.status));
    }

    private resolveDbPath(dir: string): string {
        const primary = join(dir, "brain.db");
        const compat = join(dir, "brain.compat.blackboard.db");
        if (!existsSync(primary)) return compat;
        const database = new Database(primary, { readonly: true });
        try {
            return hasIncompatibleBlackboardSchema(database) ? compat : primary;
        } finally {
            database.close();
        }
    }

    private requiredRepo(): BlackboardRepo {
        if (!this.repo) throw new Error("Socket blackboard reader is not initialized.");
        return this.repo;
    }
}

function installSchema(database: Database): void {
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
    database.exec("CREATE INDEX IF NOT EXISTS idx_blackboard_turns_project_constraint ON blackboard_turns(project_constraint_id, updated_at DESC)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_blackboard_messages_turn ON blackboard_messages(turn_id, created_at)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_blackboard_steps_turn ON blackboard_steps(turn_id, round, created_at)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_blackboard_decisions_turn ON blackboard_decisions(turn_id, created_at)");
}

function boundedLimit(limit: number | undefined): number {
    return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

function matchesBlackboardStatus(turn: BlackboardTurn, status: SocketQueryBlackboardInput["status"]): boolean {
    if (!status || status === "all") return true;
    if (status === "active") return turn.status === "running" || turn.status === "needs-user";
    if (status === "done") return turn.status === "converged";
    return turn.status === "failed";
}

function hasIncompatibleBlackboardSchema(database: Database): boolean {
    return (
        (tableExists(database, "blackboard_turns") &&
            !tableHasColumn(database, "blackboard_turns", "project_constraint_id")) ||
        (tableExists(database, "blackboard_leases") &&
            !tableHasColumn(database, "blackboard_leases", "project_constraint_id"))
    );
}

function tableExists(database: Database, table: string): boolean {
    return Boolean(getQuery<{ name: string }>(
        database,
        query`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
    ));
}

function tableHasColumn(database: Database, table: "blackboard_turns" | "blackboard_leases", column: string): boolean {
    const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
}

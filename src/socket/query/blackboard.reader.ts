import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
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
        const dbPath = this.resolveDbPath();
        const database = new Database(dbPath);
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
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

    private resolveDbPath(): string {
        const dir = join(this.paths.configDir, "brain", "live");
        const primary = join(dir, "brain.db");
        const compat = join(dir, "brain.compat.blackboard.db");
        return existsSync(primary) ? primary : compat;
    }

    private requiredRepo(): BlackboardRepo {
        if (!this.repo) throw new Error("Socket blackboard reader is not initialized.");
        return this.repo;
    }
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

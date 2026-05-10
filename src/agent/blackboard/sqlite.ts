import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { FlyflorPaths } from "../../config/index.ts";
import { Component } from "../di/decorators/index.ts";
import {
    BlackboardMode,
    BlackboardTurnStatus,
    type BlackboardDecisionKind,
    type BlackboardTurnStatus as BlackboardTurnStatusType,
    type BlackboardWorkerRole,
} from "../../protocol/contracts/index.ts";
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
    BlackboardWorkerState,
} from "./types.ts";

interface BlackboardTurnRow {
    id: string;
    session_key: string;
    request_id: string;
    mode: string;
    status: string;
    goal: string;
    budget_json: string;
    workers_json: string;
    created_at: string;
    updated_at: string;
    completed_at?: string;
    metadata_json?: string;
}

interface BlackboardStepRow {
    id: string;
    turn_id: string;
    round: number;
    worker_role: string;
    input_summary: string;
    output_summary: string;
    new_facts_json: string;
    blockers_json: string;
    risk: string;
    created_at: string;
    metadata_json?: string;
}

interface BlackboardMessageRow {
    id: string;
    turn_id: string;
    round?: number;
    worker_role?: string;
    role: string;
    content: string;
    visibility: string;
    created_at: string;
    metadata_json?: string;
}

interface BlackboardDecisionRow {
    id: string;
    turn_id: string;
    kind: string;
    prompt: string;
    options_json: string;
    reason: string;
    created_at: string;
    metadata_json?: string;
}

interface BlackboardLeaseRow {
    session_key: string;
    turn_id: string;
    request_id: string;
    acquired_at: string;
    expires_at: string;
}

@Component({ name: "sqlite-blackboard-store", tags: ["database", "blackboard"] })
export class SQLiteBlackboardStore implements BlackboardStore {
    private database?: Database;

    constructor(private readonly paths: FlyflorPaths) {}

    async initialize(): Promise<void> {
        if (this.database) {
            return;
        }

        const dir = join(this.paths.storageDir, "blackboard");
        await mkdir(dir, { recursive: true });
        const database = new Database(join(dir, "blackboard.sqlite"));
        database.exec("PRAGMA journal_mode = WAL");
        database.exec("PRAGMA synchronous = NORMAL");
        database.exec("PRAGMA foreign_keys = ON");
        database.exec(`
            CREATE TABLE IF NOT EXISTS blackboard_turns (
                id TEXT PRIMARY KEY,
                session_key TEXT NOT NULL,
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
                session_key TEXT PRIMARY KEY,
                turn_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                acquired_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
        `);
        database.exec(
            "CREATE INDEX IF NOT EXISTS idx_blackboard_turns_session ON blackboard_turns(session_key, updated_at DESC)",
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
        this.database = database;
    }

    async acquireLease(request: BlackboardLeaseAcquireRequest): Promise<BlackboardLeaseAcquireResult> {
        await this.initialize();
        const database = this.requiredDatabase();
        const expiresAt = new Date(Date.parse(request.now) + request.ttlMs).toISOString();

        database.query("DELETE FROM blackboard_leases WHERE expires_at <= ?").run(request.now);
        const existing = database
            .query("SELECT * FROM blackboard_leases WHERE session_key = ?")
            .get(request.sessionKey) as BlackboardLeaseRow | null;
        if (existing) {
            return {
                acquired: false,
                conflict: rowToLease(existing),
            };
        }

        const lease: BlackboardLease = {
            sessionKey: request.sessionKey,
            turnId: request.turnId,
            requestId: request.requestId,
            acquiredAt: request.now,
            expiresAt,
        };
        database
            .query(
                `
                INSERT INTO blackboard_leases (
                    session_key, turn_id, request_id, acquired_at, expires_at
                ) VALUES (?, ?, ?, ?, ?)
            `,
            )
            .run(lease.sessionKey, lease.turnId, lease.requestId, lease.acquiredAt, lease.expiresAt);
        return { acquired: true, lease };
    }

    async releaseLease(sessionKey: string, turnId: string, _now: string): Promise<BlackboardLease | undefined> {
        await this.initialize();
        const database = this.requiredDatabase();
        const existing = database
            .query("SELECT * FROM blackboard_leases WHERE session_key = ? AND turn_id = ?")
            .get(sessionKey, turnId) as BlackboardLeaseRow | null;
        if (!existing) {
            return undefined;
        }
        database.query("DELETE FROM blackboard_leases WHERE session_key = ? AND turn_id = ?").run(sessionKey, turnId);
        return rowToLease(existing);
    }

    async createTurn(turn: BlackboardTurn): Promise<void> {
        await this.initialize();
        this.requiredDatabase()
            .query(
                `
                INSERT INTO blackboard_turns (
                    id, session_key, request_id, mode, status, goal, budget_json,
                    workers_json, created_at, updated_at, completed_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                turn.id,
                turn.sessionKey,
                turn.requestId,
                turn.mode,
                turn.status,
                turn.goal,
                JSON.stringify(turn.budget),
                JSON.stringify(turn.workers),
                turn.createdAt,
                turn.updatedAt,
                turn.completedAt ?? null,
                JSON.stringify(turn.metadata),
            );
    }

    async appendStep(turnId: string, input: BlackboardStepInput): Promise<BlackboardStep> {
        await this.initialize();
        const step: BlackboardStep = {
            id: crypto.randomUUID(),
            turnId,
            round: input.round,
            workerRole: input.workerRole,
            inputSummary: input.inputSummary,
            outputSummary: input.outputSummary,
            newFacts: input.newFacts ?? [],
            blockers: input.blockers ?? [],
            risk: input.risk ?? "low",
            createdAt: input.createdAt,
            metadata: input.metadata ?? {},
        };
        const database = this.requiredDatabase();
        database
            .query(
                `
                INSERT INTO blackboard_steps (
                    id, turn_id, round, worker_role, input_summary, output_summary,
                    new_facts_json, blockers_json, risk, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                step.id,
                step.turnId,
                step.round,
                step.workerRole,
                step.inputSummary,
                step.outputSummary,
                JSON.stringify(step.newFacts),
                JSON.stringify(step.blockers),
                step.risk,
                step.createdAt,
                JSON.stringify(step.metadata),
            );
        this.touchTurn(turnId, input.createdAt, updateWorkerState(database, turnId, input, step.id));
        return step;
    }

    async appendMessage(turnId: string, input: BlackboardMessageInput): Promise<BlackboardMessage> {
        await this.initialize();
        const message: BlackboardMessage = {
            id: crypto.randomUUID(),
            turnId,
            round: input.round,
            workerRole: input.workerRole,
            role: input.role,
            content: input.content,
            visibility: input.visibility ?? "internal",
            createdAt: input.createdAt,
            metadata: input.metadata ?? {},
        };
        this.requiredDatabase()
            .query(
                `
                INSERT INTO blackboard_messages (
                    id, turn_id, round, worker_role, role, content, visibility,
                    created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                message.id,
                message.turnId,
                message.round ?? null,
                message.workerRole ?? null,
                message.role,
                message.content,
                message.visibility,
                message.createdAt,
                JSON.stringify(message.metadata),
            );
        this.touchTurn(turnId, input.createdAt);
        return message;
    }

    async appendDecision(turnId: string, input: BlackboardDecisionInput): Promise<BlackboardDecision> {
        await this.initialize();
        const decision: BlackboardDecision = {
            id: crypto.randomUUID(),
            turnId,
            kind: input.kind,
            prompt: input.prompt,
            options: input.options ?? [],
            reason: input.reason,
            createdAt: input.createdAt,
            metadata: input.metadata ?? {},
        };
        const database = this.requiredDatabase();
        database
            .query(
                `
                INSERT INTO blackboard_decisions (
                    id, turn_id, kind, prompt, options_json, reason, created_at, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            )
            .run(
                decision.id,
                decision.turnId,
                decision.kind,
                decision.prompt,
                JSON.stringify(decision.options),
                decision.reason,
                decision.createdAt,
                JSON.stringify(decision.metadata),
            );
        this.touchTurn(turnId, input.createdAt);
        return decision;
    }

    async updateTurnStatus(
        turnId: string,
        status: BlackboardTurnStatusType,
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        await this.initialize();
        const completedAt = status === BlackboardTurnStatus.Running ? null : now;
        this.requiredDatabase()
            .query("UPDATE blackboard_turns SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?")
            .run(status, now, completedAt, turnId);
        return this.getTurn(turnId);
    }

    async getTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        await this.initialize();
        const row = this.requiredDatabase()
            .query("SELECT * FROM blackboard_turns WHERE id = ?")
            .get(turnId) as BlackboardTurnRow | null;
        if (!row) {
            return undefined;
        }
        return this.hydrateTurn(row);
    }

    async listTurns(sessionKey: string, limit: number): Promise<BlackboardTurn[]> {
        await this.initialize();
        if (limit <= 0) {
            return [];
        }
        const rows = this.requiredDatabase()
            .query(
                `
                SELECT *
                FROM blackboard_turns
                WHERE session_key = ?
                ORDER BY updated_at DESC
                LIMIT ?
            `,
            )
            .all(sessionKey, Math.max(1, limit)) as BlackboardTurnRow[];
        return rows.map((row) => this.hydrateTurn(row));
    }

    async listRecentTurns(limit: number): Promise<BlackboardTurn[]> {
        await this.initialize();
        if (limit <= 0) {
            return [];
        }
        const rows = this.requiredDatabase()
            .query(
                `
                SELECT *
                FROM blackboard_turns
                ORDER BY updated_at DESC
                LIMIT ?
            `,
            )
            .all(Math.max(1, limit)) as BlackboardTurnRow[];
        return rows.map((row) => this.hydrateTurn(row));
    }

    private touchTurn(turnId: string, now: string, workers?: BlackboardWorkerState[]): void {
        const database = this.requiredDatabase();
        if (workers) {
            database
                .query("UPDATE blackboard_turns SET updated_at = ?, workers_json = ? WHERE id = ?")
                .run(now, JSON.stringify(workers), turnId);
            return;
        }
        database.query("UPDATE blackboard_turns SET updated_at = ? WHERE id = ?").run(now, turnId);
    }

    private hydrateTurn(row: BlackboardTurnRow): BlackboardTurn {
        const database = this.requiredDatabase();
        const steps = database
            .query("SELECT * FROM blackboard_steps WHERE turn_id = ? ORDER BY round ASC, created_at ASC")
            .all(row.id) as BlackboardStepRow[];
        const messages = database
            .query("SELECT * FROM blackboard_messages WHERE turn_id = ? ORDER BY created_at ASC")
            .all(row.id) as BlackboardMessageRow[];
        const decisions = database
            .query("SELECT * FROM blackboard_decisions WHERE turn_id = ? ORDER BY created_at ASC")
            .all(row.id) as BlackboardDecisionRow[];
        return {
            id: row.id,
            sessionKey: row.session_key,
            requestId: row.request_id,
            mode: BlackboardMode.Blackboard,
            status: row.status as BlackboardTurnStatusType,
            goal: row.goal,
            budget: parseJson(row.budget_json, defaultBudget(row.created_at)),
            workers: parseJson(row.workers_json, []),
            messages: messages.map(rowToMessage),
            steps: steps.map(rowToStep),
            decisions: decisions.map(rowToDecision),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at ?? undefined,
            metadata: parseJson(row.metadata_json, {}),
        };
    }

    private requiredDatabase(): Database {
        if (!this.database) {
            throw new Error("Blackboard store is not initialized.");
        }
        return this.database;
    }
}

function updateWorkerState(
    database: Database,
    turnId: string,
    input: BlackboardStepInput,
    stepId: string,
): BlackboardWorkerState[] {
    const row = database.query("SELECT workers_json FROM blackboard_turns WHERE id = ?").get(turnId) as {
        workers_json?: string;
    } | null;
    const workers = parseJson<BlackboardWorkerState[]>(row?.workers_json, []);
    const existing = workers.find((worker) => worker.role === input.workerRole);
    const next: BlackboardWorkerState = {
        capabilities: existing?.capabilities ?? ["general-worker"],
        dependsOn: existing?.dependsOn ?? [],
        handoff: existing?.handoff ?? "proposal",
        role: input.workerRole,
        name: existing?.name ?? input.workerRole,
        stage: existing?.stage ?? "plan",
        status: hasOpenStepIssues(input) ? "blocked" : "done",
        lastStepId: stepId,
        updatedAt: input.createdAt,
    };
    const existingIndex = workers.findIndex((worker) => worker.role === input.workerRole);
    if (existingIndex >= 0) {
        workers[existingIndex] = next;
        return workers;
    }
    return [...workers, next];
}

function hasOpenStepIssues(input: BlackboardStepInput): boolean {
    const openIssues = input.metadata?.qaOpenIssues;
    return Boolean(
        (input.blockers && input.blockers.length > 0) ||
        (Array.isArray(openIssues) && openIssues.some((item) => typeof item === "string" && item.length > 0)),
    );
}

function rowToLease(row: BlackboardLeaseRow): BlackboardLease {
    return {
        sessionKey: row.session_key,
        turnId: row.turn_id,
        requestId: row.request_id,
        acquiredAt: row.acquired_at,
        expiresAt: row.expires_at,
    };
}

function rowToStep(row: BlackboardStepRow): BlackboardStep {
    return {
        id: row.id,
        turnId: row.turn_id,
        round: row.round,
        workerRole: row.worker_role as BlackboardWorkerRole,
        inputSummary: row.input_summary,
        outputSummary: row.output_summary,
        newFacts: parseJson(row.new_facts_json, []),
        blockers: parseJson(row.blockers_json, []),
        risk: row.risk as BlackboardStep["risk"],
        createdAt: row.created_at,
        metadata: parseJson(row.metadata_json, {}),
    };
}

function rowToMessage(row: BlackboardMessageRow): BlackboardMessage {
    return {
        id: row.id,
        turnId: row.turn_id,
        round: row.round ?? undefined,
        workerRole: (row.worker_role as BlackboardWorkerRole | undefined) ?? undefined,
        role: row.role as BlackboardMessage["role"],
        content: row.content,
        visibility: row.visibility as BlackboardMessage["visibility"],
        createdAt: row.created_at,
        metadata: parseJson(row.metadata_json, {}),
    };
}

function rowToDecision(row: BlackboardDecisionRow): BlackboardDecision {
    return {
        id: row.id,
        turnId: row.turn_id,
        kind: row.kind as BlackboardDecisionKind,
        prompt: row.prompt,
        options: parseJson(row.options_json, []),
        reason: row.reason,
        createdAt: row.created_at,
        metadata: parseJson(row.metadata_json, {}),
    };
}

function parseJson<TValue>(value: string | undefined, fallback: TValue): TValue {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value) as TValue;
    } catch {
        return fallback;
    }
}

function defaultBudget(startedAt: string) {
    return {
        hardMaxRounds: 5,
        minRounds: 1,
        maxRounds: 3,
        maxWorkerContextChars: 12_000,
        startedAt,
    };
}

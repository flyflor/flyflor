import type { Database } from "bun:sqlite";
import { BlackboardTurnStatus, type BlackboardTurnStatus as BlackboardTurnStatusType } from "../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../components/sql/index.ts";
import {
    blackboardModel,
    type BlackboardDecisionRow,
    type BlackboardLeaseRow,
    type BlackboardMessageRow,
    type BlackboardStepRow,
    type BlackboardTurnRow,
} from "./entity.ts";
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
    BlackboardTurn,
    BlackboardWorkerState,
} from "../../agent/blackboard/types.ts";

/**
 * SQL repo for blackboard runtime state.
 *
 * This class owns queries for blackboard tables. Store lifecycle and schema
 * creation stay in `sqlite.ts`; row hydration stays in `entity.ts`.
 */
export class BlackboardRepo {
    public constructor(private readonly db: Database) {}

    public acquireLease(request: BlackboardLeaseAcquireRequest): BlackboardLeaseAcquireResult {
        const expiresAt = new Date(Date.parse(request.now) + request.ttlMs).toISOString();
        runQuery(this.db, query`DELETE FROM blackboard_leases WHERE expires_at <= ${request.now}`);
        const existing = getQuery<BlackboardLeaseRow>(
            this.db,
            query`SELECT * FROM blackboard_leases WHERE project_constraint_id = ${request.scopeConstraintId}`,
        );
        if (existing) {
            return {
                acquired: false,
                conflict: blackboardModel.toLease(existing),
            };
        }

        const lease: BlackboardLease = {
            scopeConstraintId: request.scopeConstraintId,
            turnId: request.turnId,
            requestId: request.requestId,
            acquiredAt: request.now,
            expiresAt,
        };
        runQuery(
            this.db,
            query`INSERT INTO blackboard_leases (
                project_constraint_id, turn_id, request_id, acquired_at, expires_at
            ) VALUES (
                ${lease.scopeConstraintId}, ${lease.turnId}, ${lease.requestId}, ${lease.acquiredAt}, ${lease.expiresAt}
            )`,
        );
        return { acquired: true, lease };
    }

    public releaseLease(scopeConstraintId: string, turnId: string): BlackboardLease | undefined {
        const existing = getQuery<BlackboardLeaseRow>(
            this.db,
            query`SELECT * FROM blackboard_leases
                WHERE project_constraint_id = ${scopeConstraintId} AND turn_id = ${turnId}`,
        );
        if (!existing) {
            return undefined;
        }
        runQuery(
            this.db,
            query`DELETE FROM blackboard_leases
                WHERE project_constraint_id = ${scopeConstraintId} AND turn_id = ${turnId}`,
        );
        return blackboardModel.toLease(existing);
    }

    public createTurn(turn: BlackboardTurn): void {
        runQuery(
            this.db,
            query`INSERT INTO blackboard_turns (
                id, project_constraint_id, request_id, mode, status, goal, budget_json,
                workers_json, created_at, updated_at, completed_at, metadata_json
            ) VALUES (
                ${turn.id}, ${turn.scopeConstraintId}, ${turn.requestId}, ${turn.mode},
                ${turn.status}, ${turn.goal}, ${JSON.stringify(turn.budget)},
                ${JSON.stringify(turn.workers)}, ${turn.createdAt}, ${turn.updatedAt},
                ${turn.completedAt ?? null}, ${JSON.stringify(turn.metadata)}
            )`,
        );
    }

    public appendStep(turnId: string, input: BlackboardStepInput): BlackboardStep {
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
        runQuery(
            this.db,
            query`INSERT INTO blackboard_steps (
                id, turn_id, round, worker_role, input_summary, output_summary,
                new_facts_json, blockers_json, risk, created_at, metadata_json
            ) VALUES (
                ${step.id}, ${step.turnId}, ${step.round}, ${step.workerRole},
                ${step.inputSummary}, ${step.outputSummary}, ${JSON.stringify(step.newFacts)},
                ${JSON.stringify(step.blockers)}, ${step.risk}, ${step.createdAt}, ${JSON.stringify(step.metadata)}
            )`,
        );
        this.touchTurn(turnId, input.createdAt, this.updateWorkerState(turnId, input, step.id));
        return step;
    }

    public appendMessage(turnId: string, input: BlackboardMessageInput): BlackboardMessage {
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
        runQuery(
            this.db,
            query`INSERT INTO blackboard_messages (
                id, turn_id, round, worker_role, role, content, visibility, created_at, metadata_json
            ) VALUES (
                ${message.id}, ${message.turnId}, ${message.round ?? null}, ${message.workerRole ?? null},
                ${message.role}, ${message.content}, ${message.visibility}, ${message.createdAt},
                ${JSON.stringify(message.metadata)}
            )`,
        );
        this.touchTurn(turnId, input.createdAt);
        return message;
    }

    public appendDecision(turnId: string, input: BlackboardDecisionInput): BlackboardDecision {
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
        runQuery(
            this.db,
            query`INSERT INTO blackboard_decisions (
                id, turn_id, kind, prompt, options_json, reason, created_at, metadata_json
            ) VALUES (
                ${decision.id}, ${decision.turnId}, ${decision.kind}, ${decision.prompt},
                ${JSON.stringify(decision.options)}, ${decision.reason}, ${decision.createdAt},
                ${JSON.stringify(decision.metadata)}
            )`,
        );
        this.touchTurn(turnId, input.createdAt);
        return decision;
    }

    public updateTurnStatus(turnId: string, status: BlackboardTurnStatusType, now: string): BlackboardTurn | undefined {
        const completedAt = status === BlackboardTurnStatus.Running ? null : now;
        runQuery(
            this.db,
            query`UPDATE blackboard_turns
                SET status = ${status}, updated_at = ${now}, completed_at = ${completedAt}
                WHERE id = ${turnId}`,
        );
        return this.getTurn(turnId);
    }

    public getTurn(turnId: string): BlackboardTurn | undefined {
        const row = getQuery<BlackboardTurnRow>(this.db, query`SELECT * FROM blackboard_turns WHERE id = ${turnId}`);
        return row ? this.hydrateTurn(row) : undefined;
    }

    public listTurns(scopeConstraintId: string, limit: number): BlackboardTurn[] {
        if (limit <= 0) {
            return [];
        }
        const rows = allQuery<BlackboardTurnRow>(
            this.db,
            query`SELECT *
                FROM blackboard_turns
                WHERE project_constraint_id = ${scopeConstraintId}
                ORDER BY updated_at DESC
                LIMIT ${Math.max(1, limit)}`,
        );
        return rows.map((row) => this.hydrateTurn(row));
    }

    public listRecentTurns(limit: number): BlackboardTurn[] {
        if (limit <= 0) {
            return [];
        }
        const rows = allQuery<BlackboardTurnRow>(
            this.db,
            query`SELECT *
                FROM blackboard_turns
                ORDER BY updated_at DESC
                LIMIT ${Math.max(1, limit)}`,
        );
        return rows.map((row) => this.hydrateTurn(row));
    }

    private touchTurn(turnId: string, now: string, workers?: BlackboardWorkerState[]): void {
        if (workers) {
            runQuery(
                this.db,
                query`UPDATE blackboard_turns
                    SET updated_at = ${now}, workers_json = ${JSON.stringify(workers)}
                    WHERE id = ${turnId}`,
            );
            return;
        }
        runQuery(this.db, query`UPDATE blackboard_turns SET updated_at = ${now} WHERE id = ${turnId}`);
    }

    private hydrateTurn(row: BlackboardTurnRow): BlackboardTurn {
        const steps = allQuery<BlackboardStepRow>(
            this.db,
            query`SELECT * FROM blackboard_steps WHERE turn_id = ${row.id} ORDER BY round ASC, created_at ASC`,
        );
        const messages = allQuery<BlackboardMessageRow>(
            this.db,
            query`SELECT * FROM blackboard_messages WHERE turn_id = ${row.id} ORDER BY created_at ASC`,
        );
        const decisions = allQuery<BlackboardDecisionRow>(
            this.db,
            query`SELECT * FROM blackboard_decisions WHERE turn_id = ${row.id} ORDER BY created_at ASC`,
        );
        return blackboardModel.toTurn(row, { decisions, messages, steps });
    }

    private updateWorkerState(turnId: string, input: BlackboardStepInput, stepId: string): BlackboardWorkerState[] {
        const row = getQuery<{ workers_json?: string }>(
            this.db,
            query`SELECT workers_json FROM blackboard_turns WHERE id = ${turnId}`,
        );
        const workers = blackboardModel.parseJson<BlackboardWorkerState[]>(row?.workers_json, []);
        const existing = workers.find((worker) => worker.role === input.workerRole);
        const next: BlackboardWorkerState = {
            capabilities: existing?.capabilities ?? ["general-worker"],
            dependsOn: existing?.dependsOn ?? [],
            handoff: existing?.handoff ?? "proposal",
            role: input.workerRole,
            name: existing?.name ?? input.workerRole,
            stage: existing?.stage ?? "plan",
            status: this.hasOpenStepIssues(input) ? "blocked" : "done",
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

    private hasOpenStepIssues(input: BlackboardStepInput): boolean {
        const openIssues = input.metadata?.qaOpenIssues;
        return Boolean(
            (input.blockers && input.blockers.length > 0) ||
                (Array.isArray(openIssues) && openIssues.some((item) => typeof item === "string" && item.length > 0)),
        );
    }
}

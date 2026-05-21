import {
    BlackboardMode,
    type BlackboardDecisionKind,
    type BlackboardTurnStatus as BlackboardTurnStatusType,
    type BlackboardWorkerRole,
} from "../../protocol/contracts/index.ts";
import type {
    BlackboardDecision,
    BlackboardLease,
    BlackboardMessage,
    BlackboardStep,
    BlackboardTurn,
} from "../../agent/blackboard/types.ts";

export interface BlackboardTurnRow {
    budget_json: string;
    completed_at?: string;
    created_at: string;
    goal: string;
    id: string;
    metadata_json?: string;
    mode: string;
    project_constraint_id: string;
    request_id: string;
    status: string;
    updated_at: string;
    workers_json: string;
}

export interface BlackboardStepRow {
    blockers_json: string;
    created_at: string;
    id: string;
    input_summary: string;
    metadata_json?: string;
    new_facts_json: string;
    output_summary: string;
    risk: string;
    round: number;
    turn_id: string;
    worker_role: string;
}

export interface BlackboardMessageRow {
    content: string;
    created_at: string;
    id: string;
    metadata_json?: string;
    role: string;
    round?: number;
    turn_id: string;
    visibility: string;
    worker_role?: string;
}

export interface BlackboardDecisionRow {
    created_at: string;
    id: string;
    kind: string;
    metadata_json?: string;
    options_json: string;
    prompt: string;
    reason: string;
    turn_id: string;
}

export interface BlackboardLeaseRow {
    acquired_at: string;
    expires_at: string;
    project_constraint_id: string;
    request_id: string;
    turn_id: string;
}

export interface BlackboardTurnRelations {
    decisions: BlackboardDecisionRow[];
    messages: BlackboardMessageRow[];
    steps: BlackboardStepRow[];
}

/**
 * Data model mapper for the blackboard SQLite tables.
 *
 * SQL lives in `repo.ts`; this class owns row hydration, JSON column
 * decoding and legacy default values for older persisted turns.
 */
export class BlackboardModel {
    public toLease(row: BlackboardLeaseRow): BlackboardLease {
        return {
            scopeConstraintId: row.project_constraint_id,
            turnId: row.turn_id,
            requestId: row.request_id,
            acquiredAt: row.acquired_at,
            expiresAt: row.expires_at,
        };
    }

    public toTurn(row: BlackboardTurnRow, relations: BlackboardTurnRelations): BlackboardTurn {
        return {
            id: row.id,
            scopeConstraintId: row.project_constraint_id,
            requestId: row.request_id,
            mode: BlackboardMode.Blackboard,
            status: row.status as BlackboardTurnStatusType,
            goal: row.goal,
            budget: this.parseJson(row.budget_json, this.defaultBudget(row.created_at)),
            workers: this.parseJson(row.workers_json, []),
            messages: relations.messages.map((message) => this.toMessage(message)),
            steps: relations.steps.map((step) => this.toStep(step)),
            decisions: relations.decisions.map((decision) => this.toDecision(decision)),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at ?? undefined,
            metadata: this.parseJson(row.metadata_json, {}),
        };
    }

    public toStep(row: BlackboardStepRow): BlackboardStep {
        return {
            id: row.id,
            turnId: row.turn_id,
            round: row.round,
            workerRole: row.worker_role as BlackboardWorkerRole,
            inputSummary: row.input_summary,
            outputSummary: row.output_summary,
            newFacts: this.parseJson(row.new_facts_json, []),
            blockers: this.parseJson(row.blockers_json, []),
            risk: row.risk as BlackboardStep["risk"],
            createdAt: row.created_at,
            metadata: this.parseJson(row.metadata_json, {}),
        };
    }

    public toMessage(row: BlackboardMessageRow): BlackboardMessage {
        return {
            id: row.id,
            turnId: row.turn_id,
            round: row.round ?? undefined,
            workerRole: (row.worker_role as BlackboardWorkerRole | undefined) ?? undefined,
            role: row.role as BlackboardMessage["role"],
            content: row.content,
            visibility: row.visibility as BlackboardMessage["visibility"],
            createdAt: row.created_at,
            metadata: this.parseJson(row.metadata_json, {}),
        };
    }

    public toDecision(row: BlackboardDecisionRow): BlackboardDecision {
        return {
            id: row.id,
            turnId: row.turn_id,
            kind: row.kind as BlackboardDecisionKind,
            prompt: row.prompt,
            options: this.parseJson(row.options_json, []),
            reason: row.reason,
            createdAt: row.created_at,
            metadata: this.parseJson(row.metadata_json, {}),
        };
    }

    public parseJson<TValue>(value: string | undefined, defaultValue: TValue): TValue {
        if (!value) {
            return defaultValue;
        }
        return JSON.parse(value) as TValue;
    }

    private defaultBudget(startedAt: string): BlackboardTurn["budget"] {
        return {
            hardMaxRounds: 5,
            minRounds: 1,
            maxRounds: 3,
            maxWorkerContextChars: 12_000,
            startedAt,
        };
    }
}

export const blackboardModel = new BlackboardModel();

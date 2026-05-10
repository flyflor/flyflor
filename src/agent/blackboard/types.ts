import {
    BlackboardTurnStatus,
    type BlackboardDecisionKind,
    type BlackboardDiscussionPlan,
    type BlackboardTurnStatus as BlackboardTurnStatusType,
    type BlackboardWorkerContract,
    type BlackboardWorkerContractContradiction,
    type BlackboardWorkerResult,
    type BlackboardWorkerRole,
    type BlackboardWorkerTask,
} from "../../protocol/contracts/index.ts";

export interface BlackboardBudget {
    hardMaxRounds: number;
    minRounds: number;
    maxRounds: number;
    maxWorkerContextChars: number;
    startedAt: string;
}

export type BlackboardContract = BlackboardWorkerContract;
export type BlackboardContractContradiction = BlackboardWorkerContractContradiction;

export type { BlackboardDiscussionPlan };

export interface BlackboardWorkerState {
    capabilities: string[];
    dependsOn: string[];
    handoff: "analysis" | "implementation" | "proposal" | "review" | "structure" | "summary" | "verification";
    role: BlackboardWorkerRole;
    name: string;
    stage: string;
    status: "idle" | "running" | "done" | "blocked";
    lastStepId?: string;
    updatedAt: string;
}

export interface BlackboardTurn {
    id: string;
    sessionKey: string;
    requestId: string;
    mode: "blackboard";
    status: BlackboardTurnStatusType;
    goal: string;
    budget: BlackboardBudget;
    workers: BlackboardWorkerState[];
    messages: BlackboardMessage[];
    steps: BlackboardStep[];
    decisions: BlackboardDecision[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    metadata: Record<string, unknown>;
}

export interface BlackboardMessage {
    id: string;
    turnId: string;
    round?: number;
    workerRole?: BlackboardWorkerRole;
    role: "adapter" | "system" | "worker" | "planner" | "reviewer" | "critic" | "assistant";
    content: string;
    visibility: "debug" | "internal" | "public";
    createdAt: string;
    metadata: Record<string, unknown>;
}

export interface BlackboardStep {
    id: string;
    turnId: string;
    round: number;
    workerRole: BlackboardWorkerRole;
    inputSummary: string;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
    risk: "low" | "medium" | "high";
    createdAt: string;
    metadata: Record<string, unknown>;
}

export interface BlackboardDecisionOption {
    id: string;
    label: string;
    description?: string;
}

export interface BlackboardDecision {
    id: string;
    turnId: string;
    kind: BlackboardDecisionKind;
    prompt: string;
    options: BlackboardDecisionOption[];
    reason: string;
    createdAt: string;
    metadata: Record<string, unknown>;
}

export interface BlackboardLease {
    sessionKey: string;
    turnId: string;
    requestId: string;
    acquiredAt: string;
    expiresAt: string;
}

export interface BlackboardStartRequest {
    sessionKey: string;
    requestId: string;
    goal: string;
    now: string;
    leaseTtlMs?: number;
    turnId?: string;
    budget?: Partial<Omit<BlackboardBudget, "startedAt">>;
    workers?: BlackboardWorkerPlanInput[];
    metadata?: Record<string, unknown>;
}

export type BlackboardStartResult =
    | {
          acquired: true;
          lease: BlackboardLease;
          turn: BlackboardTurn;
      }
    | {
          acquired: false;
          conflict: BlackboardLease;
      };

export interface BlackboardStepInput {
    round: number;
    workerRole: BlackboardWorkerRole;
    inputSummary: string;
    outputSummary: string;
    newFacts?: string[];
    blockers?: string[];
    risk?: BlackboardStep["risk"];
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface BlackboardMessageInput {
    round?: number;
    workerRole?: BlackboardWorkerRole;
    role: BlackboardMessage["role"];
    content: string;
    visibility?: BlackboardMessage["visibility"];
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface BlackboardDecisionInput {
    kind: BlackboardDecisionKind;
    prompt: string;
    options?: BlackboardDecisionOption[];
    reason: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface BlackboardWorkerRunInput {
    round: number;
    workerRole: BlackboardWorkerRole;
    createdAt: string;
    prompt?: string;
    metadata?: Record<string, unknown>;
    timeoutMs?: number;
}

export interface BlackboardWorkerPlanInput {
    capabilities?: string[];
    dependsOn?: string[];
    handoff?: BlackboardWorkerState["handoff"];
    role: BlackboardWorkerRole;
    name?: string;
    stage?: string;
}

export interface BlackboardConvergenceResult {
    reason: string;
    status: "continue" | typeof BlackboardTurnStatus.Converged | typeof BlackboardTurnStatus.NeedsUser;
}

export type { BlackboardWorkerResult, BlackboardWorkerTask };

export interface BlackboardLeaseAcquireRequest {
    sessionKey: string;
    turnId: string;
    requestId: string;
    now: string;
    ttlMs: number;
}

export type BlackboardLeaseAcquireResult =
    | {
          acquired: true;
          lease: BlackboardLease;
      }
    | {
          acquired: false;
          conflict: BlackboardLease;
      };

export interface BlackboardStore {
    acquireLease(request: BlackboardLeaseAcquireRequest): Promise<BlackboardLeaseAcquireResult>;
    appendDecision(turnId: string, decision: BlackboardDecisionInput): Promise<BlackboardDecision>;
    appendMessage(turnId: string, message: BlackboardMessageInput): Promise<BlackboardMessage>;
    appendStep(turnId: string, step: BlackboardStepInput): Promise<BlackboardStep>;
    createTurn(turn: BlackboardTurn): Promise<void>;
    getTurn(turnId: string): Promise<BlackboardTurn | undefined>;
    listRecentTurns(limit: number): Promise<BlackboardTurn[]>;
    listTurns(sessionKey: string, limit: number): Promise<BlackboardTurn[]>;
    releaseLease(sessionKey: string, turnId: string, now: string): Promise<BlackboardLease | undefined>;
    updateTurnStatus(turnId: string, status: BlackboardTurnStatus, now: string): Promise<BlackboardTurn | undefined>;
}

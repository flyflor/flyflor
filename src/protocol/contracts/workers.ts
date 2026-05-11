import type { BlackboardWorkerOutcome, BlackboardWorkerRole } from "./enums.ts";

export interface BlackboardWorkerTask {
    turnId: string;
    sessionKey: string;
    requestId: string;
    goal: string;
    contract: BlackboardWorkerContract;
    convergencePolicy: BlackboardConvergencePolicy;
    discussionPlan?: BlackboardDiscussionPlan;
    round: number;
    workerRole: BlackboardWorkerRole;
    prompt?: string;
    currentRoundSteps: BlackboardWorkerTaskStep[];
    previousSteps: BlackboardWorkerTaskStep[];
    decisions: BlackboardWorkerTaskDecision[];
}

export interface BlackboardDiscussionPlan {
    objective: string;
    participants: BlackboardDiscussionParticipant[];
    qaGoal: string;
    workstreams: string[];
}

export interface BlackboardDiscussionParticipant {
    capabilities: string[];
    dependsOn: string[];
    handoff: "analysis" | "implementation" | "proposal" | "review" | "structure" | "summary" | "verification";
    name: string;
    order: number;
    role: BlackboardWorkerRole;
    stage: string;
}

export interface BlackboardConvergencePolicy {
    forceHardCap: boolean;
    reason: string;
}

export interface BlackboardWorkerContract {
    contradictions: BlackboardWorkerContractContradiction[];
    evidence: string[];
    mode: "normal" | "non-convergent";
    policyReason: string;
    proposition?: string;
    reviewerTrigger?: string;
}

export interface BlackboardWorkerContractContradiction {
    left: string;
    reason: string;
    right: string;
}

export interface BlackboardWorkerTaskStep {
    round: number;
    workerRole: BlackboardWorkerRole;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
    agreement?: boolean;
    outcome?: BlackboardWorkerOutcome;
    questions?: string[];
    answers?: string[];
    openIssues?: string[];
}

export interface BlackboardWorkerTaskDecision {
    kind: string;
    prompt: string;
    reason: string;
}

export interface BlackboardWorkerResult {
    inputSummary: string;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
    risk: "low" | "medium" | "high";
    agreement?: boolean;
    outcome?: BlackboardWorkerOutcome;
    questions?: string[];
    answers?: string[];
    openIssues?: string[];
    proposal?: string;
    discussion?: BlackboardWorkerDiscussion[];
    metadata?: Record<string, unknown>;
}

export interface BlackboardWorkerDiscussion {
    role: string;
    content: string;
    visibility?: "debug" | "internal" | "public";
    metadata?: Record<string, unknown>;
}

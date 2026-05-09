import type { BlackboardWorkerRole } from "./enums.ts";

export interface BlackboardWorkerTask {
    turnId: string;
    sessionKey: string;
    requestId: string;
    goal: string;
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
    qaGoal: string;
    workstreams: string[];
}

export interface BlackboardWorkerTaskStep {
    round: number;
    workerRole: BlackboardWorkerRole;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
    agreement?: boolean;
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
    questions?: string[];
    answers?: string[];
    openIssues?: string[];
    proposal?: string;
    discussion?: BlackboardWorkerDiscussion[];
    metadata?: Record<string, unknown>;
}

export interface BlackboardWorkerDiscussion {
    role: "assistant" | "critic" | "planner" | "reviewer" | "system" | "worker";
    content: string;
    visibility?: "debug" | "internal" | "public";
    metadata?: Record<string, unknown>;
}

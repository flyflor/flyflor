import type { BlackboardWorkerRole } from "./enums.ts";

export interface BlackboardWorkerTask {
    turnId: string;
    sessionKey: string;
    requestId: string;
    goal: string;
    round: number;
    workerRole: BlackboardWorkerRole;
    prompt?: string;
    previousSteps: BlackboardWorkerTaskStep[];
    decisions: BlackboardWorkerTaskDecision[];
}

export interface BlackboardWorkerTaskStep {
    round: number;
    workerRole: BlackboardWorkerRole;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
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
    discussion?: BlackboardWorkerDiscussion[];
    metadata?: Record<string, unknown>;
}

export interface BlackboardWorkerDiscussion {
    role: "assistant" | "critic" | "planner" | "reviewer" | "system" | "worker";
    content: string;
    visibility?: "debug" | "internal" | "public";
    metadata?: Record<string, unknown>;
}

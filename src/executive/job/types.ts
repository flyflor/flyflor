import type { ExecutiveToolRuntimeAskRequired, ExecutiveToolRuntimeBudget } from "../tool.runtime.ts";
import type { ExecutionJobLedgerContent } from "../../protocol/contracts/index.ts";

export const ExecutionJobStatus = {
    Created: "created",
    Planning: "planning",
    Running: "running",
    ChildRunning: "child-running",
    NeedsUser: "needs-user",
    Paused: "paused",
    Completed: "completed",
    Failed: "failed",
    Cancelled: "cancelled",
} as const;

export type ExecutionJobStatus = (typeof ExecutionJobStatus)[keyof typeof ExecutionJobStatus];

export const ExecutionJobStage = {
    Created: "created",
    Planning: "planning",
    Running: "running",
    ChildRunning: "child-running",
    Paused: "paused",
    Completed: "completed",
} as const;

export type ExecutionJobStage = (typeof ExecutionJobStage)[keyof typeof ExecutionJobStage];

export interface ExecutionJobProgress {
    readonly childCompleted: number;
    readonly childFailed: number;
    readonly childNeedsUser: number;
    readonly childTotal: number;
    readonly toolCalls: number;
}

export interface ExecutionJobPause {
    readonly askId?: string;
    readonly message: string;
    readonly reason: string;
}

export interface ExecutionJobToolExecution {
    readonly childJobId?: string;
    readonly error?: string;
    readonly ok: boolean;
    readonly server: string;
    readonly tool: string;
}

export interface ExecutionChildJob {
    readonly childJobId: string;
    readonly completedAt?: string;
    readonly createdAt: string;
    readonly id: string;
    readonly parentJobId: string;
    readonly status: ExecutionJobStatus;
    readonly toolCalls: number;
    readonly updatedAt: string;
}

export interface ExecutionJob {
    readonly askId?: string;
    readonly budget?: ExecutiveToolRuntimeBudget;
    readonly children: readonly ExecutionChildJob[];
    readonly completedAt?: string;
    readonly createdAt: string;
    readonly crystalCandidate?: ExecutiveToolRuntimeAskRequired["crystalCandidate"];
    readonly jobId: string;
    readonly ownerKey?: string;
    readonly parentJobId?: string;
    readonly pause?: ExecutionJobPause;
    readonly progress: ExecutionJobProgress;
    readonly requestId: string;
    readonly sourceKey?: string;
    readonly stage: ExecutionJobStage;
    readonly status: ExecutionJobStatus;
    readonly toolExecutions: readonly ExecutionJobToolExecution[];
    readonly updatedAt: string;
}

export interface ExecutionJobCreateInput {
    readonly budget?: ExecutiveToolRuntimeBudget;
    readonly childIds: readonly string[];
    readonly ownerKey?: string;
    readonly parentJobId?: string;
    readonly requestId: string;
    readonly sourceKey?: string;
}

export interface ExecutionJobChildUpdateInput {
    readonly askRequired?: ExecutiveToolRuntimeAskRequired;
    readonly childJobId: string;
    readonly status: "completed" | "failed" | "needs_user";
    readonly toolExecutions: readonly ExecutionJobToolExecution[];
}

export interface ExecutionJobLedgerEvent {
    readonly content: ExecutionJobLedgerContent;
    readonly ownerKey?: string;
    readonly parentId?: string;
    readonly sourceKey?: string;
}

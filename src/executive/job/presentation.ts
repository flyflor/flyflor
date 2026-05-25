import { Component } from "../../agent/di/decorators/index.ts";
import { CapabilityComponent } from "../../components/index.ts";
import type { ExecutionJob } from "./types.ts";

export interface ExecutionJobSnapshot {
    readonly askId?: string;
    readonly childJobIds: readonly string[];
    readonly jobId: string;
    readonly progress: ExecutionJob["progress"];
    readonly stage: ExecutionJob["stage"];
    readonly status: ExecutionJob["status"];
}

/**
 * Bounded job projection for reply metadata and later socket query snapshots.
 */
@Component()
export class ExecutionJobPresentation extends CapabilityComponent {
    public snapshot(job: ExecutionJob): ExecutionJobSnapshot {
        return {
            askId: job.askId,
            childJobIds: job.children.map((child) => child.childJobId),
            jobId: job.jobId,
            progress: job.progress,
            stage: job.stage,
            status: job.status,
        };
    }
}

export const executionJobPresentation = new ExecutionJobPresentation();

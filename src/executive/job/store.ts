import { Component } from "../../agent/di/decorators/index.ts";
import { CapabilityComponent } from "../../components/index.ts";
import { ExecutionJobEventKind } from "../../protocol/contracts/index.ts";
import {
    ExecutionJobStage,
    ExecutionJobStatus,
    type ExecutionChildJob,
    type ExecutionJob,
    type ExecutionJobChildUpdateInput,
    type ExecutionJobCreateInput,
    type ExecutionJobLedgerEvent,
    type ExecutionJobProgress,
} from "./types.ts";

/**
 * In-memory job snapshot store.
 *
 * Phase 5 keeps jobs process-local so subagent.batch has a durable owner shape.
 * Phase 6 will mirror these transitions into brain.db without changing callers.
 */
@Component()
export class ExecutionJobStore extends CapabilityComponent {
    private readonly jobs = new Map<string, ExecutionJob>();

    public constructor(private readonly onEvent?: (event: ExecutionJobLedgerEvent) => void) {
        super();
    }

    public create(input: ExecutionJobCreateInput): ExecutionJob {
        const now = new Date().toISOString();
        const jobId = crypto.randomUUID();
        const children = input.childIds.map((id): ExecutionChildJob => ({
            childJobId: crypto.randomUUID(),
            createdAt: now,
            id,
            parentJobId: jobId,
            status: ExecutionJobStatus.Created,
            toolCalls: 0,
            updatedAt: now,
        }));
        const job: ExecutionJob = {
            budget: input.budget,
            children,
            createdAt: now,
            jobId,
            ownerKey: input.ownerKey,
            parentJobId: input.parentJobId,
            progress: this.progress(children, []),
            requestId: input.requestId,
            sourceKey: input.sourceKey,
            stage: ExecutionJobStage.Created,
            status: ExecutionJobStatus.Created,
            toolExecutions: [],
            updatedAt: now,
        };
        this.jobs.set(jobId, job);
        this.emit(job, ExecutionJobEventKind.Created, { summary: `Execution job created with ${children.length} child tasks.` });
        return job;
    }

    public markRunning(jobId: string): ExecutionJob | undefined {
        const job = this.update(jobId, {
            stage: ExecutionJobStage.Running,
            status: ExecutionJobStatus.Running,
        });
        if (job) this.emit(job, ExecutionJobEventKind.StageChanged, { summary: "Execution job is running." });
        return job;
    }

    public markChildRunning(jobId: string, childJobId: string): ExecutionJob | undefined {
        const job = this.jobs.get(jobId);
        if (!job) return undefined;
        const children = job.children.map((child) =>
            child.childJobId === childJobId
                ? { ...child, status: ExecutionJobStatus.Running, updatedAt: new Date().toISOString() }
                : child,
        );
        const next = this.replace(job, {
            children,
            stage: ExecutionJobStage.ChildRunning,
            status: ExecutionJobStatus.ChildRunning,
        });
        const child = children.find((candidate) => candidate.childJobId === childJobId);
        this.emit(next, ExecutionJobEventKind.ChildStarted, {
            childJobId,
            summary: `Child job ${child?.id ?? childJobId} started.`,
        });
        return next;
    }

    public completeChild(jobId: string, input: ExecutionJobChildUpdateInput): ExecutionJob | undefined {
        const job = this.jobs.get(jobId);
        if (!job) return undefined;
        const now = new Date().toISOString();
        const childStatus = this.childStatus(input.status);
        const children = job.children.map((child) =>
            child.childJobId === input.childJobId
                ? {
                      ...child,
                      completedAt: now,
                      status: childStatus,
                      toolCalls: input.toolExecutions.length,
                      updatedAt: now,
                  }
                : child,
        );
        const toolExecutions = [...job.toolExecutions, ...input.toolExecutions];
        const next = this.replace(job, {
            askId: input.askRequired?.askId ?? job.askId,
            children,
            crystalCandidate: input.askRequired?.crystalCandidate ?? job.crystalCandidate,
            pause: input.askRequired
                ? {
                      askId: input.askRequired.askId,
                      message: input.askRequired.message,
                      reason: input.askRequired.budgetExhaustedReason ?? input.askRequired.loopGuardReason ?? "subagent-needs-user",
                  }
                : job.pause,
            progress: this.progress(children, toolExecutions),
            stage: input.status === "needs_user" ? ExecutionJobStage.Paused : job.stage,
            status: input.status === "needs_user" ? ExecutionJobStatus.NeedsUser : job.status,
            toolExecutions,
        });
        const kind = this.childLedgerKind(input.status);
        this.emit(next, kind, {
            askId: input.askRequired?.askId,
            childJobId: input.childJobId,
            crystalCandidate: input.askRequired?.crystalCandidate,
            error: input.askRequired?.message,
            summary: `Child job ${input.childJobId} ${input.status}.`,
        });
        for (const execution of input.toolExecutions) {
            this.emit(next, ExecutionJobEventKind.ToolExecuted, {
                childJobId: input.childJobId,
                error: execution.error,
                summary: `${execution.server}.${execution.tool} ${execution.ok ? "ok" : "failed"}.`,
                tool: {
                    key: execution.key ?? `${execution.server}.${execution.tool}`,
                    server: execution.server,
                    tool: execution.tool,
                    inputPreview: execution.inputPreview,
                    outputPreview: execution.outputPreview,
                    error: execution.error?.slice(0, 240),
                    durationMs: execution.durationMs,
                    limited: execution.limited,
                    limitReason: execution.limitReason,
                    ok: execution.ok,
                },
            });
        }
        if (input.askRequired) {
            this.emit(next, ExecutionJobEventKind.PausedAsk, {
                askId: input.askRequired.askId,
                childJobId: input.childJobId,
                crystalCandidate: input.askRequired.crystalCandidate,
                summary: input.askRequired.message.slice(0, 240),
            });
        }
        return next;
    }

    public finish(jobId: string): ExecutionJob | undefined {
        const job = this.jobs.get(jobId);
        if (!job) return undefined;
        const now = new Date().toISOString();
        const status = this.finalStatus(job);
        const next = this.replace(job, {
            completedAt: now,
            progress: this.progress(job.children, job.toolExecutions),
            stage: status === ExecutionJobStatus.NeedsUser ? ExecutionJobStage.Paused : ExecutionJobStage.Completed,
            status,
        });
        this.emit(next, status === ExecutionJobStatus.Failed ? ExecutionJobEventKind.Failed : ExecutionJobEventKind.Completed, {
            summary: `Execution job finished with status ${status}.`,
        });
        return next;
    }

    public get(jobId: string): ExecutionJob | undefined {
        return this.jobs.get(jobId);
    }

    private update(jobId: string, patch: Partial<ExecutionJob>): ExecutionJob | undefined {
        const job = this.jobs.get(jobId);
        if (!job) return undefined;
        return this.replace(job, patch);
    }

    private replace(job: ExecutionJob, patch: Partial<ExecutionJob>): ExecutionJob {
        const next = {
            ...job,
            ...patch,
            updatedAt: new Date().toISOString(),
        };
        this.jobs.set(job.jobId, next);
        return next;
    }

    private finalStatus(job: ExecutionJob): ExecutionJobStatus {
        if (job.children.some((child) => child.status === ExecutionJobStatus.NeedsUser)) {
            return ExecutionJobStatus.NeedsUser;
        }
        if (job.children.some((child) => child.status === ExecutionJobStatus.Failed)) {
            return ExecutionJobStatus.Failed;
        }
        return ExecutionJobStatus.Completed;
    }

    private childStatus(status: ExecutionJobChildUpdateInput["status"]): ExecutionJobStatus {
        switch (status) {
            case "completed":
                return ExecutionJobStatus.Completed;
            case "failed":
                return ExecutionJobStatus.Failed;
            case "needs_user":
                return ExecutionJobStatus.NeedsUser;
        }
    }

    private childLedgerKind(status: ExecutionJobChildUpdateInput["status"]) {
        switch (status) {
            case "completed":
                return ExecutionJobEventKind.ChildCompleted;
            case "failed":
                return ExecutionJobEventKind.ChildFailed;
            case "needs_user":
                return ExecutionJobEventKind.ChildNeedsUser;
        }
    }

    private emit(
        job: ExecutionJob,
        kind: ExecutionJobEventKind,
        patch: Partial<ExecutionJobLedgerEvent["content"]> = {},
    ): void {
        this.onEvent?.({
            content: {
                askId: job.askId,
                jobId: job.jobId,
                kind,
                parentJobId: job.parentJobId,
                progress: job.progress as unknown as Record<string, unknown>,
                requestId: job.requestId,
                sourceKey: job.sourceKey,
                stage: job.stage,
                status: job.status,
                ts: Date.now(),
                ...patch,
            },
            ownerKey: job.ownerKey,
            sourceKey: job.sourceKey,
        });
    }

    private progress(
        children: readonly ExecutionChildJob[],
        toolExecutions: readonly unknown[],
    ): ExecutionJobProgress {
        return {
            childCompleted: children.filter((child) => child.status === ExecutionJobStatus.Completed).length,
            childFailed: children.filter((child) => child.status === ExecutionJobStatus.Failed).length,
            childNeedsUser: children.filter((child) => child.status === ExecutionJobStatus.NeedsUser).length,
            childTotal: children.length,
            toolCalls: toolExecutions.length,
        };
    }
}

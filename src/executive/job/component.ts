import { Component } from "../../agent/di/decorators/index.ts";
import { CapabilityComponent } from "../../components/index.ts";
import type { ExecutionJobChildUpdateInput, ExecutionJobCreateInput, ExecutionJobLedgerEvent } from "./types.ts";
import { ExecutionJobStore } from "./store.ts";
import { ExecutionJobPresentation, executionJobPresentation } from "./presentation.ts";

@Component()
export class ExecutionJobComponent extends CapabilityComponent {
    public constructor(
        private readonly store: ExecutionJobStore = new ExecutionJobStore(),
        private readonly presentation: ExecutionJobPresentation = executionJobPresentation,
    ) {
        super();
    }

    public static withLedger(onEvent: (event: ExecutionJobLedgerEvent) => void): ExecutionJobComponent {
        return new ExecutionJobComponent(new ExecutionJobStore(onEvent));
    }

    public create(input: ExecutionJobCreateInput) {
        return this.store.create(input);
    }

    public markRunning(jobId: string) {
        return this.store.markRunning(jobId);
    }

    public markChildRunning(jobId: string, childJobId: string) {
        return this.store.markChildRunning(jobId, childJobId);
    }

    public completeChild(jobId: string, input: ExecutionJobChildUpdateInput) {
        return this.store.completeChild(jobId, input);
    }

    public finish(jobId: string) {
        return this.store.finish(jobId);
    }

    public snapshot(jobId: string) {
        const job = this.store.get(jobId);
        return job ? this.presentation.snapshot(job) : undefined;
    }
}

export const executionJobComponent = new ExecutionJobComponent();

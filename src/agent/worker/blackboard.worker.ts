import {
    BlackboardWorkerOutcome,
    ModelRole,
    WorkerInteractionKind,
    WorkerRuntimeKind,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
    type ModelClient,
} from "../di/index.ts";
import type { WorkerManager } from "./worker.manager.ts";
import type { WorkerAdapter, WorkerRunContext } from "./types.ts";
import { normalizeBlackboardWorkerOutput } from "./blackboard.worker.normalize.ts";

export const BLACKBOARD_MODEL_WORKER_NAME = "blackboard-model-worker";

export interface ModelBackedBlackboardWorkerPrompts {
    systemPrompt(participant: string): string;
}

class ModelBackedBlackboardWorker {
    constructor(
        private readonly model: ModelClient,
        private readonly prompts: ModelBackedBlackboardWorkerPrompts,
    ) {}

    run(input: BlackboardWorkerTask, _context: WorkerRunContext): Promise<BlackboardWorkerResult> {
        return runModelBackedWorker(this.model, input, input.workerRole, this.prompts);
    }
}

class ModelBackedBlackboardWorkerAdapter implements WorkerAdapter<
    ModelBackedBlackboardWorker,
    BlackboardWorkerTask,
    BlackboardWorkerResult
> {
    readonly interaction = WorkerInteractionKind.OneShot;
    readonly runtime = WorkerRuntimeKind.InProcess;

    run(
        target: ModelBackedBlackboardWorker,
        input: BlackboardWorkerTask,
        context: WorkerRunContext,
    ): Promise<BlackboardWorkerResult> {
        return target.run(input, context);
    }
}

export function registerModelBackedBlackboardWorker(
    manager: WorkerManager,
    model: ModelClient,
    prompts: ModelBackedBlackboardWorkerPrompts,
): void {
    if (manager.has(BLACKBOARD_MODEL_WORKER_NAME)) {
        return;
    }
    manager.registerDynamic<ModelBackedBlackboardWorker, BlackboardWorkerTask, BlackboardWorkerResult>(
        new ModelBackedBlackboardWorker(model, prompts),
        new ModelBackedBlackboardWorkerAdapter(),
        {
            manifest: {
                name: BLACKBOARD_MODEL_WORKER_NAME,
                description:
                    "Generic model-backed blackboard worker. The prompt-selected participant role is carried in the task envelope.",
                tags: ["blackboard", "model-backed"],
            },
        },
    );
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

async function runModelBackedWorker(
    model: ModelClient,
    input: BlackboardWorkerTask,
    participant: string,
    prompts: ModelBackedBlackboardWorkerPrompts,
): Promise<BlackboardWorkerResult> {
    const raw = await model.generate([
        {
            role: ModelRole.System,
            content: prompts.systemPrompt(participant),
        },
        {
            role: ModelRole.User,
            content: input.prompt ?? JSON.stringify(input),
        },
    ]);
    return normalizeBlackboardWorkerOutput(input, participant, raw);
}

export { normalizeBlackboardWorkerOutput as normalizeModelWorkerResult } from "./blackboard.worker.normalize.ts";

import type { ComponentMetadata, WorkerInteractionKind, WorkerRuntimeKind, WorkerTaskStatus } from "../di/index.ts";

export interface ManagedWorker<TInput = unknown, TOutput = unknown> {
    run(input: TInput, context: WorkerRunContext): Promise<TOutput> | TOutput;
}

export interface WorkerAdapter<TTarget = unknown, TInput = unknown, TOutput = unknown> {
    readonly interaction: WorkerInteractionKind;
    readonly runtime: WorkerRuntimeKind;
    dispose?(target: TTarget): Promise<void> | void;
    run(target: TTarget, input: TInput, context: WorkerRunContext): Promise<TOutput> | TOutput;
}

export interface WorkerManifest {
    capabilities?: string[];
    name: string;
    description?: string;
    protocol?: string;
    tags?: string[];
}

export interface JsonProcessWorkerSpec {
    cmd: string[];
    cwd: string;
    env?: Record<string, string>;
    outputLimitBytes?: number;
    startupTimeoutMs?: number;
}

export interface WorkerRunContext {
    interaction: WorkerInteractionKind;
    taskId: string;
    workerName: string;
    runtime: WorkerRuntimeKind;
    requestId?: string;
    sessionKey?: string;
    turnId?: string;
    createdAt: string;
}

export interface WorkerRegistration<TInput = unknown, TOutput = unknown> {
    name: string;
    adapter: WorkerAdapter<unknown, TInput, TOutput>;
    target: unknown;
    metadata: ComponentMetadata;
    runtime: WorkerRuntimeKind;
    interaction: WorkerInteractionKind;
    maxConcurrency: number;
    queueLimit: number;
    timeoutMs: number;
}

export interface WorkerRegisterOptions {
    maxConcurrency?: number;
    name?: string;
    queueLimit?: number;
    runtime?: WorkerRuntimeKind;
    interaction?: WorkerInteractionKind;
    timeoutMs?: number;
}

export interface DynamicWorkerRegisterOptions extends WorkerRegisterOptions {
    manifest: WorkerManifest;
}

export interface WorkerRunOptions {
    requestId?: string;
    sessionKey?: string;
    timeoutMs?: number;
    turnId?: string;
}

export interface WorkerRunResult<TOutput = unknown> {
    taskId: string;
    workerName: string;
    status: WorkerTaskStatus;
    output?: TOutput;
    error?: string;
    queuedAt: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
}

export interface WorkerSummary {
    name: string;
    kind: string;
    layer: string;
    runtime: WorkerRuntimeKind;
    interaction: WorkerInteractionKind;
    active: number;
    queued: number;
    maxConcurrency: number;
    queueLimit: number;
    tags: string[];
}

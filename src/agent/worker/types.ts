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

/**
 * Raw-stdio worker spec：spawn 一个子进程，从 stdin 喂入纯文本，stdout 文本作为输出。
 *
 * 与 JsonProcessWorkerSpec 的区别：
 * - 输入 / 输出都是纯字符串（不强制 JSON），适合包装 agent-cli 这类外部 LLM 命令；
 * - 没有 PTY（bun --compile 不带 node-pty native binding），子进程 isatty=false；
 *   需要真 PTY 的程序请自行 wrap 一层 `script(1)` / `expect`；
 * - 由 child_process.spawn 隔离，崩溃不影响主进程。
 */
export interface RawStdioWorkerSpec {
    cmd: string[];
    cwd: string;
    env?: Record<string, string>;
    /** 向 stdin 写入的额外 framing（例如尾部 EOF 标记），默认无。 */
    inputSuffix?: string;
    outputLimitBytes?: number;
    /** 允许的非零退出码集合（默认仅 0）。 */
    okExitCodes?: number[];
}

export interface WorkerRunContext {
    interaction: WorkerInteractionKind;
    taskId: string;
    workerName: string;
    runtime: WorkerRuntimeKind;
    requestId?: string;
    projectConstraintId?: string;
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
    projectConstraintId?: string;
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

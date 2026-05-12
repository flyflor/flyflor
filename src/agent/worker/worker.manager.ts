import {
    ComponentKind,
    RuntimeEventType,
    WorkerInteractionKind,
    WorkerRuntimeKind,
    WorkerTaskStatus,
    event,
    componentRegistry,
    NullEventSink,
    type ComponentMetadata,
    type EventSink,
} from "../di/index.ts";
import type {
    DynamicWorkerRegisterOptions,
    JsonProcessWorkerSpec,
    ManagedWorker,
    RawStdioWorkerSpec,
    WorkerAdapter,
    WorkerManifest,
    WorkerRegisterOptions,
    WorkerRegistration,
    WorkerRunContext,
    WorkerRunOptions,
    WorkerRunResult,
    WorkerSummary,
} from "./types.ts";

const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_QUEUE_LIMIT = 64;
const DEFAULT_TIMEOUT_MS = 60_000;

interface QueuedTask<TInput, TOutput> {
    id: string;
    input: TInput;
    options: WorkerRunOptions;
    queuedAt: string;
    reject(error: Error): void;
    resolve(result: WorkerRunResult<TOutput>): void;
}

interface PoolState {
    active: number;
    queue: QueuedTask<unknown, unknown>[];
}

export class WorkerManager {
    private readonly registrations = new Map<string, WorkerRegistration>();
    private readonly pools = new Map<string, PoolState>();

    constructor(private readonly events: EventSink = new NullEventSink()) {}

    register<TInput, TOutput>(
        instance: ManagedWorker<TInput, TOutput>,
        options: WorkerRegisterOptions = {},
    ): WorkerRegistration<TInput, TOutput> {
        const metadata = componentRegistry.assertKind(instance.constructor, ComponentKind.Worker);
        return this.registerWithMetadata(instance, new InProcessWorkerAdapter<TInput, TOutput>(), metadata, options);
    }

    registerDynamic<TTarget, TInput, TOutput>(
        target: TTarget,
        adapter: WorkerAdapter<TTarget, TInput, TOutput>,
        options: DynamicWorkerRegisterOptions,
    ): WorkerRegistration<TInput, TOutput> {
        return this.registerWithMetadata(target, adapter, metadataFromManifest(options.manifest), options);
    }

    registerJsonProcess<TInput, TOutput>(
        manifest: WorkerManifest,
        spec: JsonProcessWorkerSpec,
        options: WorkerRegisterOptions = {},
    ): WorkerRegistration<TInput, TOutput> {
        return this.registerDynamic<JsonProcessWorkerSpec, TInput, TOutput>(
            spec,
            new JsonProcessWorkerAdapter<TInput, TOutput>(),
            {
                ...options,
                manifest,
                runtime: options.runtime ?? WorkerRuntimeKind.JsonProcess,
            },
        );
    }

    registerPersistentJsonProcess<TInput, TOutput>(
        manifest: WorkerManifest,
        spec: JsonProcessWorkerSpec,
        options: WorkerRegisterOptions = {},
    ): WorkerRegistration<TInput, TOutput> {
        return this.registerDynamic<JsonProcessWorkerSpec, TInput, TOutput>(
            spec,
            new PersistentJsonProcessWorkerAdapter<TInput, TOutput>(),
            {
                ...options,
                interaction: options.interaction ?? WorkerInteractionKind.Persistent,
                manifest,
                runtime: options.runtime ?? WorkerRuntimeKind.PersistentJsonProcess,
            },
        );
    }

    /** 注册 raw-stdio 工作器：spawn 外部命令，纯文本进 / 纯文本出。 */
    registerRawStdioProcess(
        manifest: WorkerManifest,
        spec: RawStdioWorkerSpec,
        options: WorkerRegisterOptions = {},
    ): WorkerRegistration<string, string> {
        return this.registerDynamic<RawStdioWorkerSpec, string, string>(spec, new RawStdioWorkerAdapter(), {
            ...options,
            manifest,
            runtime: options.runtime ?? WorkerRuntimeKind.Process,
        });
    }

    has(name: string): boolean {
        return this.registrations.has(name);
    }

    list(): WorkerSummary[] {
        return [...this.registrations.values()].map((registration) => {
            const pool = this.poolFor(registration.name);
            return {
                name: registration.name,
                kind: registration.metadata.kind,
                interaction: registration.interaction,
                layer: registration.metadata.layer,
                runtime: registration.runtime,
                active: pool.active,
                queued: pool.queue.length,
                maxConcurrency: registration.maxConcurrency,
                queueLimit: registration.queueLimit,
                tags: registration.metadata.tags,
            };
        });
    }

    run<TInput, TOutput>(
        workerName: string,
        input: TInput,
        options: WorkerRunOptions = {},
    ): Promise<WorkerRunResult<TOutput>> {
        const registration = this.registrationFor<TInput, TOutput>(workerName);
        const pool = this.poolFor(workerName);
        if (pool.queue.length >= registration.queueLimit) {
            throw new Error(`Worker queue is full: ${workerName}`);
        }

        const queuedAt = new Date().toISOString();
        const task = new Promise<WorkerRunResult<TOutput>>((resolve, reject) => {
            pool.queue.push({
                id: crypto.randomUUID(),
                input,
                options,
                queuedAt,
                resolve,
                reject,
            } as QueuedTask<unknown, unknown>);
        });
        this.events.publish(
            event(
                RuntimeEventType.WorkerTaskQueued,
                {
                    queued: pool.queue.length,
                    taskId: pool.queue.at(-1)?.id,
                    workerName,
                },
                options.requestId,
            ),
        );
        this.drain(workerName);
        return task;
    }

    private registerWithMetadata<TTarget, TInput, TOutput>(
        target: TTarget,
        adapter: WorkerAdapter<TTarget, TInput, TOutput>,
        metadata: ComponentMetadata,
        options: WorkerRegisterOptions,
    ): WorkerRegistration<TInput, TOutput> {
        const name = options.name ?? metadata.name;
        if (this.registrations.has(name)) {
            throw new Error(`Worker already registered: ${name}`);
        }

        const registration: WorkerRegistration<TInput, TOutput> = {
            name,
            adapter: adapter as WorkerAdapter<unknown, TInput, TOutput>,
            target,
            metadata,
            interaction: options.interaction ?? adapter.interaction,
            runtime: options.runtime ?? adapter.runtime,
            maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
            queueLimit: options.queueLimit ?? DEFAULT_QUEUE_LIMIT,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        };
        this.registrations.set(name, registration as WorkerRegistration);
        this.pools.set(name, { active: 0, queue: [] });
        this.publishRegistered(registration);
        return registration;
    }

    private drain(workerName: string): void {
        const registration = this.registrationFor(workerName);
        const pool = this.poolFor(workerName);

        while (pool.active < registration.maxConcurrency && pool.queue.length > 0) {
            const task = pool.queue.shift();
            if (!task) {
                return;
            }
            pool.active += 1;
            void this.execute(registration, task).then((result) => {
                pool.active -= 1;
                this.drain(workerName);
                task.resolve(result);
            });
        }
    }

    private async execute<TInput, TOutput>(
        registration: WorkerRegistration<TInput, TOutput>,
        task: QueuedTask<TInput, TOutput>,
    ): Promise<WorkerRunResult<TOutput>> {
        const startedAt = new Date().toISOString();
        const started = performance.now();
        const context: WorkerRunContext = {
            interaction: registration.interaction,
            taskId: task.id,
            workerName: registration.name,
            runtime: registration.runtime,
            requestId: task.options.requestId,
            projectConstraintId: task.options.projectConstraintId,
            turnId: task.options.turnId,
            createdAt: startedAt,
        };

        this.events.publish(
            event(
                RuntimeEventType.WorkerTaskStart,
                {
                    runtime: registration.runtime,
                    taskId: task.id,
                    workerName: registration.name,
                },
                task.options.requestId,
            ),
        );

        try {
            const output = await withTimeout(
                Promise.resolve(registration.adapter.run(registration.target, task.input, context)),
                task.options.timeoutMs ?? registration.timeoutMs,
                registration.name,
            );
            const result = taskResult<TOutput>({
                elapsedMs: performance.now() - started,
                output,
                queuedAt: task.queuedAt,
                startedAt,
                status: WorkerTaskStatus.Completed,
                taskId: task.id,
                workerName: registration.name,
            });
            this.events.publish(
                event(
                    RuntimeEventType.WorkerTaskEnd,
                    {
                        elapsedMs: result.elapsedMs,
                        status: result.status,
                        taskId: task.id,
                        workerName: registration.name,
                    },
                    task.options.requestId,
                ),
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const status = message.includes("timed out") ? WorkerTaskStatus.Timeout : WorkerTaskStatus.Failed;
            const result = taskResult<TOutput>({
                elapsedMs: performance.now() - started,
                error: message,
                queuedAt: task.queuedAt,
                startedAt,
                status,
                taskId: task.id,
                workerName: registration.name,
            });
            this.events.publish(
                event(
                    RuntimeEventType.WorkerTaskFailed,
                    {
                        elapsedMs: result.elapsedMs,
                        error: message,
                        status,
                        taskId: task.id,
                        workerName: registration.name,
                    },
                    task.options.requestId,
                ),
            );
            return result;
        }
    }

    private registrationFor<TInput = unknown, TOutput = unknown>(name: string): WorkerRegistration<TInput, TOutput> {
        const registration = this.registrations.get(name);
        if (!registration) {
            throw new Error(`Worker is not registered: ${name}`);
        }
        return registration as WorkerRegistration<TInput, TOutput>;
    }

    private poolFor(name: string): PoolState {
        const pool = this.pools.get(name);
        if (!pool) {
            throw new Error(`Worker pool is not registered: ${name}`);
        }
        return pool;
    }

    private publishRegistered(registration: WorkerRegistration): void {
        this.events.publish(
            event(RuntimeEventType.WorkerRegistered, {
                kind: registration.metadata.kind,
                layer: registration.metadata.layer,
                name: registration.name,
                runtime: registration.runtime,
                interaction: registration.interaction,
                tags: registration.metadata.tags,
            }),
        );
    }
}

export class JsonProcessWorkerAdapter<TInput, TOutput> implements WorkerAdapter<
    JsonProcessWorkerSpec,
    TInput,
    TOutput
> {
    readonly interaction = WorkerInteractionKind.OneShot;
    readonly runtime = WorkerRuntimeKind.JsonProcess;

    async run(target: JsonProcessWorkerSpec, input: TInput, context: WorkerRunContext): Promise<TOutput> {
        const child = Bun.spawn({
            cmd: target.cmd,
            cwd: target.cwd,
            env: target.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdin = child.stdin;
        if (!stdin || typeof stdin === "number") {
            throw new Error("JSON process worker stdin is not writable.");
        }
        stdin.write(`${JSON.stringify({ context, input })}\n`);
        stdin.end();

        const [stdout, stderr, exitCode] = await Promise.all([
            readLimited(child.stdout, target.outputLimitBytes ?? 256 * 1024),
            readLimited(child.stderr, target.outputLimitBytes ?? 64 * 1024),
            child.exited,
        ]);
        if (exitCode !== 0) {
            throw new Error(`JSON process worker exited with ${exitCode}: ${stderr.trim()}`);
        }
        try {
            return JSON.parse(stdout) as TOutput;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`JSON process worker returned invalid JSON: ${message}`);
        }
    }
}

export class PersistentJsonProcessWorkerAdapter<TInput, TOutput> implements WorkerAdapter<
    JsonProcessWorkerSpec,
    TInput,
    TOutput
> {
    readonly interaction = WorkerInteractionKind.Persistent;
    readonly runtime = WorkerRuntimeKind.PersistentJsonProcess;
    private readonly connections = new WeakMap<JsonProcessWorkerSpec, PersistentJsonConnection>();

    async dispose(target: JsonProcessWorkerSpec): Promise<void> {
        const connection = this.connections.get(target);
        if (!connection) {
            return;
        }
        this.connections.delete(target);
        await connection.stop();
    }

    async run(target: JsonProcessWorkerSpec, input: TInput, context: WorkerRunContext): Promise<TOutput> {
        return this.connectionFor(target).request<TInput, TOutput>(input, context);
    }

    private connectionFor(target: JsonProcessWorkerSpec): PersistentJsonConnection {
        const existing = this.connections.get(target);
        if (existing) {
            return existing;
        }
        const connection = new PersistentJsonConnection(target);
        this.connections.set(target, connection);
        return connection;
    }
}

/**
 * Raw-stdio adapter：spawn 子进程 → 写 stdin → 等 exit → 读 stdout。
 *
 * 与 JsonProcessWorkerAdapter 同构，但不强制 JSON。失败：
 * - 退出码不在 okExitCodes（默认 [0]）→ 抛包含 stderr 的 Error；
 * - 进程未启动 / spawn 抛错 → 透传。
 *
 * bun --compile 安全：仅用 Bun.spawn + 普通 pipe，无 native addon。
 */
export class RawStdioWorkerAdapter implements WorkerAdapter<RawStdioWorkerSpec, string, string> {
    readonly interaction = WorkerInteractionKind.OneShot;
    readonly runtime = WorkerRuntimeKind.Process;

    async run(target: RawStdioWorkerSpec, input: string, _context: WorkerRunContext): Promise<string> {
        const child = Bun.spawn({
            cmd: target.cmd,
            cwd: target.cwd,
            env: target.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdin = child.stdin;
        if (!stdin || typeof stdin === "number") {
            throw new Error("Raw-stdio worker stdin is not writable.");
        }
        stdin.write(input);
        if (target.inputSuffix) {
            stdin.write(target.inputSuffix);
        }
        stdin.end();

        const [stdout, stderr, exitCode] = await Promise.all([
            readLimited(child.stdout, target.outputLimitBytes ?? 1024 * 1024),
            readLimited(child.stderr, target.outputLimitBytes ?? 64 * 1024),
            child.exited,
        ]);
        const okCodes = target.okExitCodes ?? [0];
        if (!okCodes.includes(exitCode)) {
            throw new Error(`Raw-stdio worker exited with ${exitCode}: ${stderr.trim()}`);
        }
        return stdout;
    }
}

export type * from "./types.ts";

class InProcessWorkerAdapter<TInput, TOutput> implements WorkerAdapter<
    ManagedWorker<TInput, TOutput>,
    TInput,
    TOutput
> {
    readonly interaction = WorkerInteractionKind.OneShot;
    readonly runtime = WorkerRuntimeKind.InProcess;

    run(target: ManagedWorker<TInput, TOutput>, input: TInput, context: WorkerRunContext): Promise<TOutput> | TOutput {
        return target.run(input, context);
    }
}

function taskResult<TOutput>(input: {
    elapsedMs: number;
    error?: string;
    output?: TOutput;
    queuedAt: string;
    startedAt: string;
    status: WorkerTaskStatus;
    taskId: string;
    workerName: string;
}): WorkerRunResult<TOutput> {
    return {
        taskId: input.taskId,
        workerName: input.workerName,
        status: input.status,
        output: input.output,
        error: input.error,
        queuedAt: input.queuedAt,
        startedAt: input.startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Number(input.elapsedMs.toFixed(3)),
    };
}

async function withTimeout<TValue>(promise: Promise<TValue>, timeoutMs: number, workerName: string): Promise<TValue> {
    let timer: Timer | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Worker timed out: ${workerName}`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
        const read = await reader.read();
        if (read.done) {
            break;
        }
        total += read.value.byteLength;
        if (total > limit) {
            throw new Error(`Worker output exceeded ${limit} bytes.`);
        }
        chunks.push(read.value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
}

interface PersistentJsonResponse {
    error?: string;
    id?: string;
    output?: unknown;
}

class PersistentJsonConnection {
    private readonly child: ReturnType<typeof Bun.spawn>;
    private readonly pending = new Map<
        string,
        {
            reject(error: Error): void;
            resolve(value: unknown): void;
        }
    >();
    private stopped = false;

    constructor(private readonly spec: JsonProcessWorkerSpec) {
        this.child = Bun.spawn({
            cmd: spec.cmd,
            cwd: spec.cwd,
            env: spec.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        void this.readStdout();
        void this.drainStderr();
        void this.child.exited.then((exitCode) => this.rejectAll(new Error(`Persistent worker exited: ${exitCode}`)));
    }

    request<TInput, TOutput>(input: TInput, context: WorkerRunContext): Promise<TOutput> {
        if (this.stopped) {
            throw new Error("Persistent worker connection is stopped.");
        }
        const stdin = this.child.stdin;
        if (!stdin || typeof stdin === "number") {
            throw new Error("Persistent worker stdin is not writable.");
        }

        const line = `${JSON.stringify({ context, input })}\n`;
        const output = new Promise<TOutput>((resolve, reject) => {
            this.pending.set(context.taskId, {
                resolve: (value) => resolve(value as TOutput),
                reject,
            });
        });
        stdin.write(line);
        return output;
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.child.kill();
        await this.child.exited;
    }

    private async readStdout(): Promise<void> {
        const stdout = this.child.stdout;
        if (!stdout || typeof stdout === "number") {
            this.rejectAll(new Error("Persistent worker stdout is not readable."));
            return;
        }
        const reader = stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const read = await reader.read();
            if (read.done) {
                break;
            }
            buffer += decoder.decode(read.value, { stream: true });
            const lines = buffer.split(/\r?\n/u);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                this.handleLine(line);
            }
        }
        if (buffer.trim()) {
            this.handleLine(buffer);
        }
    }

    private async drainStderr(): Promise<void> {
        const stderr = this.child.stderr;
        if (!stderr || typeof stderr === "number") {
            return;
        }
        try {
            await readLimited(stderr, this.spec.outputLimitBytes ?? 64 * 1024);
        } catch {
            this.child.kill();
        }
    }

    private handleLine(line: string): void {
        const text = line.trim();
        if (!text) {
            return;
        }
        let response: PersistentJsonResponse;
        try {
            response = JSON.parse(text) as PersistentJsonResponse;
        } catch (error) {
            this.rejectAll(
                new Error(
                    `Persistent worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
            return;
        }

        const id = response.id ?? (this.pending.size === 1 ? this.pending.keys().next().value : undefined);
        if (!id) {
            this.rejectAll(new Error("Persistent worker response is missing id."));
            return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
            return;
        }
        this.pending.delete(id);
        if (response.error) {
            pending.reject(new Error(response.error));
            return;
        }
        pending.resolve(response.output);
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

function metadataFromManifest(manifest: WorkerManifest): ComponentMetadata {
    return {
        kind: ComponentKind.Worker,
        layer: "capability",
        name: manifest.name,
        provider: {
            scope: "singleton",
            token: `capability.${manifest.name}`,
        },
        tags: manifest.tags ?? [],
    };
}

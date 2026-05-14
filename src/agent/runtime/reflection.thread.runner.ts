/**
 * 主线程侧：管理反思规范化的 Bun Worker 单例。
 * 模型调用仍由 RuntimeModule 在主线程发起；本运行器只承担 raw → CrystalCandidateInput[]
 * 的纯解析/规范化工作，避免长 JSON 在主线程阻塞事件循环。
 */
import type { CrystalCandidateInput } from "../../crystal/reflection/index.ts";
import { normalizeReflectionRaw, type ReflectionNormalizeSource } from "./reflection.normalize.ts";

export interface ReflectionThreadWorkerLike {
    postMessage(data: unknown): void;
    terminate(): void;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
}

export type ReflectionWorkerFactory = () => ReflectionThreadWorkerLike;

export interface ReflectionThreadRunnerOptions {
    workerFactory?: ReflectionWorkerFactory;
    timeoutMs?: number;
}

interface PendingEntry {
    resolve(result: CrystalCandidateInput[]): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    raw: string;
    source: ReflectionNormalizeSource;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export class ReflectionThreadRunner {
    private worker: ReflectionThreadWorkerLike | null = null;
    private readonly pending = new Map<number, PendingEntry>();
    private nextId = 1;
    private readonly factory: ReflectionWorkerFactory;
    private readonly timeoutMs: number;

    constructor(options: ReflectionThreadRunnerOptions = {}) {
        this.factory = options.workerFactory ?? defaultWorkerFactory;
        this.timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }

    async normalize(raw: string, source: ReflectionNormalizeSource): Promise<CrystalCandidateInput[]> {
        const worker = this.ensureWorker();
        const id = this.nextId++;
        return new Promise<CrystalCandidateInput[]>((resolve, reject) => {
            const timer = setTimeout(() => {
                const entry = this.pending.get(id);
                if (!entry) return;
                this.pending.delete(id);
                settleWithFallback(entry);
            }, this.timeoutMs);
            this.pending.set(id, { raw, source, resolve, reject, timer });
            try {
                worker.postMessage({ kind: "normalize", id, raw, source });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                resolve(normalizeReflectionRaw(raw, source));
            }
        });
    }

    dispose(): void {
        if (!this.worker) return;
        for (const [id, entry] of this.pending) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.reject(new Error("ReflectionThreadRunner disposed"));
        }
        this.worker.terminate();
        this.worker = null;
    }

    private ensureWorker(): ReflectionThreadWorkerLike {
        if (this.worker) return this.worker;
        const worker = this.factory();
        worker.onmessage = (event: MessageEvent) => {
            const data = event.data as {
                id?: number;
                ok?: boolean;
                result?: CrystalCandidateInput[];
                error?: string;
            };
            if (!data || typeof data.id !== "number") return;
            const entry = this.pending.get(data.id);
            if (!entry) return;
            this.pending.delete(data.id);
            clearTimeout(entry.timer);
            if (data.ok && data.result) {
                entry.resolve(data.result);
            } else {
                settleWithFallback(entry);
            }
        };
        worker.onerror = () => {
            for (const [id, entry] of this.pending) {
                clearTimeout(entry.timer);
                this.pending.delete(id);
                settleWithFallback(entry);
            }
            this.worker = null;
        };
        this.worker = worker;
        return worker;
    }
}

function defaultWorkerFactory(): ReflectionThreadWorkerLike {
    const url = new URL("./reflection.worker.thread.ts", import.meta.url);
    // biome-ignore lint/suspicious/noExplicitAny: Bun Worker constructor types differ across runtimes
    const worker = new (globalThis as any).Worker(url.href, { type: "module" }) as ReflectionThreadWorkerLike;
    return worker;
}

function settleWithFallback(entry: PendingEntry): void {
    try {
        entry.resolve(normalizeReflectionRaw(entry.raw, entry.source));
    } catch (error) {
        // 主线程 fallback 只替代 worker transport；如果模型本身不是合法
        // reflection JSON，仍要 reject，让 ReflectionWorker 记录失败事件。
        entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
}

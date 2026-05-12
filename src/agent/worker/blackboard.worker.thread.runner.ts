/**
 * 主线程侧：管理 Bun Worker 单例 + 请求/响应配对。
 *
 * 设计：
 *  - 进程内单 Worker 实例（懒创建），所有黑板规范化请求复用同一线程，避免反复
 *    cold-start；测试可注入 `WorkerFactory` 替换为同步实现以保持确定性。
 *  - 自增 id 关联 postMessage / message 回调；超时回退到主线程同步规范化（best-effort）。
 *  - dispose() 关闭 Worker，pending Promise 全部 reject。
 *
 * 注意：本运行器**不调用模型**，只负责把 raw 文本送进 Worker 并取回结构化结果。
 */
import { normalizeBlackboardWorkerOutput } from "./blackboard.worker.normalize.ts";
import type { BlackboardWorkerResult, BlackboardWorkerTask } from "../di/index.ts";

export interface BlackboardThreadWorkerLike {
    postMessage(data: unknown): void;
    terminate(): void;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
}

export type BlackboardWorkerFactory = () => BlackboardThreadWorkerLike;

export interface BlackboardThreadRunnerOptions {
    /** Worker 构造工厂；默认走 Bun 内置 `new Worker(import.meta.url-relative)`。 */
    workerFactory?: BlackboardWorkerFactory;
    /** 单次 normalize 超时（ms）。超时后回退到主线程同步执行。默认 2000。 */
    timeoutMs?: number;
}

interface PendingEntry {
    resolve(result: BlackboardWorkerResult): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    fallback: () => BlackboardWorkerResult;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export class BlackboardThreadRunner {
    private worker: BlackboardThreadWorkerLike | null = null;
    private readonly pending = new Map<number, PendingEntry>();
    private nextId = 1;
    private readonly factory: BlackboardWorkerFactory;
    private readonly timeoutMs: number;

    constructor(options: BlackboardThreadRunnerOptions = {}) {
        this.factory = options.workerFactory ?? defaultWorkerFactory;
        this.timeoutMs = Math.max(50, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }

    async normalize(
        input: BlackboardWorkerTask,
        participant: string,
        raw: string,
    ): Promise<BlackboardWorkerResult> {
        const worker = this.ensureWorker();
        const id = this.nextId++;
        const fallback = () => normalizeBlackboardWorkerOutput(input, participant, raw);
        return new Promise<BlackboardWorkerResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                const entry = this.pending.get(id);
                if (!entry) return;
                this.pending.delete(id);
                resolve(entry.fallback());
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer, fallback });
            try {
                worker.postMessage({ kind: "normalize", id, input, participant, raw });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                // postMessage 失败立即回退；不让上层报错。
                resolve(fallback());
            }
        });
    }

    dispose(): void {
        if (!this.worker) return;
        for (const [id, entry] of this.pending) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.reject(new Error("BlackboardThreadRunner disposed"));
        }
        try {
            this.worker.terminate();
        } catch {
            // ignore
        }
        this.worker = null;
    }

    private ensureWorker(): BlackboardThreadWorkerLike {
        if (this.worker) return this.worker;
        const worker = this.factory();
        worker.onmessage = (event: MessageEvent) => {
            const data = event.data as { id?: number; ok?: boolean; result?: BlackboardWorkerResult; error?: string };
            if (!data || typeof data.id !== "number") return;
            const entry = this.pending.get(data.id);
            if (!entry) return;
            this.pending.delete(data.id);
            clearTimeout(entry.timer);
            if (data.ok && data.result) {
                entry.resolve(data.result);
            } else {
                // 线程内异常：回退到主线程规范化，保持 best-effort 行为。
                entry.resolve(entry.fallback());
            }
        };
        worker.onerror = () => {
            // Worker 整体崩溃：丢弃实例，让下一次 normalize 重新创建。
            for (const [id, entry] of this.pending) {
                clearTimeout(entry.timer);
                this.pending.delete(id);
                entry.resolve(entry.fallback());
            }
            this.worker = null;
        };
        this.worker = worker;
        return worker;
    }
}

function defaultWorkerFactory(): BlackboardThreadWorkerLike {
    // `new URL(..., import.meta.url)` 在 Bun（含 `bun build --compile`）下解析为
    // 内嵌模块；不需要构建期 bundling。
    const url = new URL("./blackboard.worker.thread.ts", import.meta.url);
    // biome-ignore lint/suspicious/noExplicitAny: Bun Worker constructor types differ across runtimes
    const worker = new (globalThis as any).Worker(url.href, { type: "module" }) as BlackboardThreadWorkerLike;
    return worker;
}

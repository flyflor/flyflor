/**
 * Bun Worker（线程）入口：把 BlackboardWorker 的纯解析/规范化挪到线程，
 * 解放主线程事件循环。LLM 网络请求仍在主线程发起；线程仅处理 raw → result。
 *
 * 协议（postMessage 一来一回）：
 *   request:  { kind: "normalize"; id: number; input; participant; raw }
 *   response: { id: number; ok: true; result }  |  { id: number; ok: false; error }
 *
 * bun --compile 安全：仅 import 同包的纯函数模块，无 native addon。
 */
import { normalizeBlackboardWorkerOutput } from "./blackboard.worker.normalize.ts";
import type { BlackboardWorkerTask } from "../di/index.ts";

interface NormalizeRequest {
    kind: "normalize";
    id: number;
    input: BlackboardWorkerTask;
    participant: string;
    raw: string;
}

// `self` is typed loosely inside Worker context; we cast through unknown.
// biome-ignore lint/suspicious/noExplicitAny: Web Worker global self is not in Bun's default lib
const scope = (globalThis as any).self as {
    onmessage: ((event: MessageEvent<NormalizeRequest>) => void) | null;
    postMessage: (data: unknown) => void;
};

scope.onmessage = (event: MessageEvent<NormalizeRequest>) => {
    const message = event.data;
    if (!message || message.kind !== "normalize") return;
    try {
        const result = normalizeBlackboardWorkerOutput(message.input, message.participant, message.raw);
        scope.postMessage({ id: message.id, ok: true, result });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        scope.postMessage({ id: message.id, ok: false, error: detail });
    }
};

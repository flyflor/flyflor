/**
 * Bun Worker 入口：把反思候选规范化挪到线程。LLM 调用仍在主线程发起。
 *
 * 协议：
 *   request:  { kind: "normalize"; id; raw; source }
 *   response: { id; ok: true; result } | { id; ok: false; error }
 */
import { normalizeReflectionRaw, type ReflectionNormalizeSource } from "./reflection.normalize.ts";

interface NormalizeRequest {
    kind: "normalize";
    id: number;
    raw: string;
    source: ReflectionNormalizeSource;
}

// biome-ignore lint/suspicious/noExplicitAny: Web Worker global self is not in Bun's default lib
const scope = (globalThis as any).self as {
    onmessage: ((event: MessageEvent<NormalizeRequest>) => void) | null;
    postMessage: (data: unknown) => void;
};

scope.onmessage = (event: MessageEvent<NormalizeRequest>) => {
    const message = event.data;
    if (!message || message.kind !== "normalize") return;
    try {
        const result = normalizeReflectionRaw(message.raw, message.source);
        scope.postMessage({ id: message.id, ok: true, result });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        scope.postMessage({ id: message.id, ok: false, error: detail });
    }
};

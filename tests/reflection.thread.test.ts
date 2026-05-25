import { describe, expect, test } from "bun:test";
import {
    ReflectionThreadRunner,
    normalizeReflectionRaw,
    type ReflectionNormalizeSource,
    type ReflectionThreadWorkerLike,
} from "../src/agent/runtime/index.ts";
import { BlackboardMode } from "../src/protocol/contracts/index.ts";

const baseSource: ReflectionNormalizeSource = {
    answer: "the answer",
    now: "2025-01-01T00:00:00Z",
    request: "hello",
    requestId: "req-1",
    route: { mode: BlackboardMode.Direct, reason: "simple" },
};

function makeFakeWorker(impl: (msg: unknown) => unknown): ReflectionThreadWorkerLike {
    const worker: ReflectionThreadWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage(data: unknown) {
            queueMicrotask(() => {
                const response = impl(data);
                if (worker.onmessage) worker.onmessage({ data: response } as MessageEvent);
            });
        },
        terminate() {
            worker.onmessage = null;
        },
    };
    return worker;
}

const rawJson = JSON.stringify([
    { title: "shadow-debt", method: "freeze and audit", symbols: ["debt", "audit"] },
]);

describe("ReflectionThreadRunner", () => {
    test("relays thread response", async () => {
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number; raw: string; source: ReflectionNormalizeSource };
            return { id: m.id, ok: true, result: normalizeReflectionRaw(m.raw, m.source) };
        });
        const runner = new ReflectionThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const result = await runner.normalize(rawJson, baseSource);
        expect(result.length).toBe(1);
        expect(result[0]?.title).toBe("shadow-debt");
        runner.dispose();
    });

    test("falls back to main thread on worker error", async () => {
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number };
            return { id: m.id, ok: false, error: "boom" };
        });
        const runner = new ReflectionThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const result = await runner.normalize(rawJson, baseSource);
        expect(result.length).toBe(1);
        expect(result[0]?.title).toBe("shadow-debt");
        runner.dispose();
    });

    test("times out and uses fallback", async () => {
        const fake = makeFakeWorker(() => undefined);
        const runner = new ReflectionThreadRunner({ workerFactory: () => fake, timeoutMs: 30 });
        const result = await runner.normalize(rawJson, baseSource);
        expect(result.length).toBe(1);
        runner.dispose();
    });

    test("parity with main thread normalize", async () => {
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number; raw: string; source: ReflectionNormalizeSource };
            return { id: m.id, ok: true, result: normalizeReflectionRaw(m.raw, m.source) };
        });
        const runner = new ReflectionThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const fromThread = await runner.normalize(rawJson, baseSource);
        const fromMain = normalizeReflectionRaw(rawJson, baseSource);
        expect(fromThread.map((c) => c.title)).toEqual(fromMain.map((c) => c.title));
        expect(fromThread.map((c) => c.method)).toEqual(fromMain.map((c) => c.method));
        runner.dispose();
    });

    test("turns structured executive ASK evidence into a crystal candidate without promoting it directly", () => {
        const result = normalizeReflectionRaw("[]", {
            ...baseSource,
            executiveToolLoop: {
                ask: {
                    authority: "executive",
                    crystalCandidates: [
                        {
                            kind: "tool-stability",
                            stability: {
                                effective: "unavailable",
                                reason: "external sidecar command is unavailable",
                            },
                        },
                    ],
                    prompt: "tool blocked",
                    reason: "policy-decision",
                    source: "tool-stability",
                },
                askId: "ask-1",
                message: "tool blocked",
                resume: { mode: "continue" },
                stepCount: 1,
                stop: "ask",
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            sourceKind: "executive-ask-candidate",
            sourceId: "ask-1",
            title: "executive:tool-stability",
            evidence: [
                expect.objectContaining({
                    kind: "executive-ask-structured-candidate",
                    weight: 0.55,
                }),
            ],
        });
    });
});

import { describe, expect, test } from "bun:test";
import {
    BlackboardThreadRunner,
    normalizeBlackboardWorkerOutput,
    type BlackboardThreadWorkerLike,
} from "../src/agent/worker/index.ts";
import { BlackboardWorkerOutcome, type BlackboardWorkerTask } from "../src/agent/di/index.ts";

const baseTask: BlackboardWorkerTask = {
    turnId: "t1",
    sessionKey: "sess",
    requestId: "req",
    workerRole: "analyst",
    round: 1,
    goal: "evaluate proposal",
    prompt: "{}",
    contract: { contradictions: [], evidence: [], mode: "normal", policyReason: "" },
    convergencePolicy: { forceHardCap: false, reason: "" },
    currentRoundSteps: [],
    previousSteps: [],
    decisions: [],
};

function makeFakeWorker(impl: (msg: unknown) => unknown): BlackboardThreadWorkerLike {
    const worker: BlackboardThreadWorkerLike = {
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

describe("BlackboardThreadRunner", () => {
    test("relays structured response from worker", async () => {
        const raw = JSON.stringify({
            outputSummary: "looks good",
            outcome: BlackboardWorkerOutcome.Final,
        });
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number; input: BlackboardWorkerTask; participant: string; raw: string };
            const result = normalizeBlackboardWorkerOutput(m.input, m.participant, m.raw);
            return { id: m.id, ok: true, result };
        });
        const runner = new BlackboardThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const result = await runner.normalize(baseTask, "analyst", raw);
        expect(result.outputSummary).toBe("looks good");
        expect(result.outcome).toBe(BlackboardWorkerOutcome.Final);
        runner.dispose();
    });

    test("falls back to main-thread normalize when worker errors", async () => {
        const raw = JSON.stringify({ outputSummary: "fallback" });
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number };
            return { id: m.id, ok: false, error: "boom" };
        });
        const runner = new BlackboardThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const result = await runner.normalize(baseTask, "analyst", raw);
        expect(result.outputSummary).toBe("fallback");
        runner.dispose();
    });

    test("times out gracefully and uses fallback", async () => {
        // worker never responds
        const fake = makeFakeWorker(() => undefined);
        const runner = new BlackboardThreadRunner({ workerFactory: () => fake, timeoutMs: 50 });
        const raw = JSON.stringify({ outputSummary: "timeout-fallback" });
        const result = await runner.normalize(baseTask, "analyst", raw);
        expect(result.outputSummary).toBe("timeout-fallback");
        runner.dispose();
    });

    test("parity with main-thread normalize for raw text", async () => {
        const raw = "free-form text without JSON";
        const fake = makeFakeWorker((msg) => {
            const m = msg as { id: number; input: BlackboardWorkerTask; participant: string; raw: string };
            return { id: m.id, ok: true, result: normalizeBlackboardWorkerOutput(m.input, m.participant, m.raw) };
        });
        const runner = new BlackboardThreadRunner({ workerFactory: () => fake, timeoutMs: 500 });
        const threadResult = await runner.normalize(baseTask, "analyst", raw);
        const mainResult = normalizeBlackboardWorkerOutput(baseTask, "analyst", raw);
        expect(threadResult.outcome).toBe(mainResult.outcome);
        expect(threadResult.outputSummary).toBe(mainResult.outputSummary);
        expect(threadResult.openIssues).toEqual(mainResult.openIssues);
        runner.dispose();
    });
});

import { describe, expect, test } from "bun:test";
import { ReflectionWorker, type ReflectionBlackboardRun } from "../src/agent/runtime/index.ts";
import {
    BlackboardMode,
    ChatType,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import type { MemoryEpisodeProvenance, MemoryModule } from "../src/cognitive/hippocampus/memory/index.ts";
import { ReflectionThreadRunner, type ReflectionThreadWorkerLike, type ReflectionNormalizeSource } from "../src/agent/runtime/index.ts";
import { normalizeReflectionRaw } from "../src/agent/runtime/index.ts";
import type { BlackboardDecision } from "../src/agent/blackboard/index.ts";

class CapturingSink implements EventSink {
    public readonly events: Array<{ type: string; payload?: unknown }> = [];

    public publish(input: { type: string; payload?: unknown }): void {
        this.events.push({ type: input.type, payload: input.payload });
    }
}

class StubMemory implements Pick<MemoryModule, "applyReflection"> {
    public readonly calls: Array<{ candidates: unknown[]; context: RuntimeContext }> = [];

    public async applyReflection(candidates: unknown[], context: RuntimeContext): Promise<void> {
        this.calls.push({ candidates, context });
    }
}

class StubModel implements ModelClient {
    public constructor(private readonly responses: string[] | (() => Promise<string>)) {}

    public async generate(_messages: ModelMessage[]): Promise<string> {
        return Array.isArray(this.responses) ? this.responses.shift() ?? "[]" : this.responses();
    }
}

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

const baseContext: RuntimeContext = { requestId: "req-1", now: "2025-01-01T00:00:00Z" };
const baseMessage: GatewayMessage = {
    id: "msg-1",
    route: { channel: "api", chatId: "chat-1", chatType: ChatType.Direct },
    user: { id: "user-1" },
    text: "turn text",
    receivedAt: "2025-01-01T00:00:00Z",
};
const baseProvenance: MemoryEpisodeProvenance = { mcpCalls: [], skillNames: [] };
const baseDecision: BlackboardDecision = {
    createdAt: "2025-01-01T00:00:00Z",
    id: "decision-1",
    kind: "single-choice",
    metadata: {},
    options: [],
    prompt: "p",
    reason: "r",
    turnId: "turn-1",
};

const baseBlackboard: ReflectionBlackboardRun = {
    decisions: [baseDecision],
    metadata: {},
    mode: BlackboardMode.Blackboard,
    reason: "blackboard",
    steps: [{ blockers: ["b"], newFacts: ["f"], outputSummary: "o", workerRole: "w" }],
    status: "converged",
    turnId: "turn-1",
};

describe("ReflectionWorker", () => {
    test("dispatches candidates into memory when blackboard reflection is warranted", async () => {
        const sink = new CapturingSink();
        const memory = new StubMemory();
        const runner = new ReflectionThreadRunner({
            workerFactory: () =>
                makeFakeWorker((msg) => {
                    const m = msg as { id: number; raw: string; source: ReflectionNormalizeSource };
                    return { id: m.id, ok: true, result: normalizeReflectionRaw(m.raw, m.source) };
                }),
        });
        const worker = new ReflectionWorker({
            events: sink,
            memory,
            model: new StubModel([
                JSON.stringify([{ title: "shadow-debt", method: "freeze and audit", symbols: ["debt"] }]),
            ]),
            normalizer: runner,
        });

        await worker.dispatch({
            blackboardRun: baseBlackboard,
            context: baseContext,
            message: baseMessage,
            provenance: baseProvenance,
            visibleText: "visible turn",
        });

        expect(memory.calls.length).toBe(1);
        expect(memory.calls[0]?.candidates.length).toBe(1);
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemoryReflectionFailed)).toBeUndefined();
        worker.dispose();
    });

    test("skips reflection when no signal is present", async () => {
        const sink = new CapturingSink();
        const memory = new StubMemory();
        const worker = new ReflectionWorker({
            events: sink,
            memory,
            model: new StubModel(["[]"]),
        });

        await worker.dispatch({
            context: baseContext,
            message: baseMessage,
            provenance: baseProvenance,
            visibleText: "visible turn",
        });

        expect(memory.calls.length).toBe(0);
        expect(sink.events.length).toBe(0);
        worker.dispose();
    });

    test("publishes failure when model extraction throws", async () => {
        const sink = new CapturingSink();
        const memory = new StubMemory();
        const worker = new ReflectionWorker({
            events: sink,
            memory,
            model: {
                generate: async () => {
                    throw new Error("boom");
                },
            },
        });

        await worker.dispatch({
            blackboardRun: baseBlackboard,
            context: baseContext,
            message: baseMessage,
            provenance: baseProvenance,
            visibleText: "visible turn",
        });

        expect(memory.calls.length).toBe(0);
        expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryReflectionFailed)).toBe(true);
        worker.dispose();
    });
});

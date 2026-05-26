import { describe, expect, test } from "bun:test";
import { ExecutiveLoopGuardReason } from "../src/protocol/contracts/index.ts";
import {
    ExecutiveToolRuntime,
    type ExecutiveLoopGuardDecision,
    type ExecutiveToolExecution,
} from "../src/executive/index.ts";

interface TestToolCall {
    readonly input: Readonly<Record<string, unknown>>;
    readonly key: string;
}

interface TestToolExecution extends ExecutiveToolExecution<TestToolCall> {
    readonly call: TestToolCall;
    readonly ok: boolean;
    readonly error?: string;
    readonly result?: unknown;
}

describe("ExecutiveToolRuntime", () => {
    test("batches read-only concurrent calls and serializes write or execute calls", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const batches: string[][] = [];
        const calls = [
            call("workspace.read", { path: "a" }),
            call("workspace.read", { path: "b" }),
            call("workspace.write", { path: "c" }),
            call("docs.fetch", { uri: "one" }),
            call("docs.fetch", { uri: "two" }),
            call("shell.run", { command: "true" }),
        ];

        const result = await runtime.executeScheduled(calls, {
            execute: async (batch) => {
                batches.push(batch.map((item) => item.key));
                return batch.map((item) => ({ call: item, ok: true, result: { key: item.key } }));
            },
            generate: async () => "",
            knownToolNames: () => new Set(calls.map((item) => item.key)),
            parse: () => ({ calls: [], text: "" }),
            renderResults: () => "",
            toolDescriptor: (item) => descriptorFor(item.key),
        });

        expect(result.map((execution) => execution.call.key)).toEqual(calls.map((item) => item.key));
        expect(batches).toEqual([
            ["workspace.read", "workspace.read"],
            ["workspace.write"],
            ["docs.fetch", "docs.fetch"],
            ["shell.run"],
        ]);
    });

    test("rejects tool adapters that omit, add, or reorder execution results", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const calls = [
            call("workspace.read", { path: "a" }),
            call("workspace.read", { path: "b" }),
        ];
        const callbacks = {
            generate: async () => "",
            knownToolNames: () => new Set(calls.map((item) => item.key)),
            parse: () => ({ calls: [], text: "" }),
            renderResults: () => "",
            toolDescriptor: () => ({ concurrencySafe: true, exclusive: false, readOnly: true }),
        };

        await expect(runtime.executeScheduled(calls, {
            ...callbacks,
            execute: async (batch) => batch.slice(0, 1).map((item) => ({ call: item, ok: true })),
        })).rejects.toThrow("Executive tool adapter returned 1 results for 2 calls.");

        await expect(runtime.executeScheduled(calls, {
            ...callbacks,
            execute: async (batch) => [
                ...batch.map((item) => ({ call: item, ok: true })),
                { call: call("workspace.read", { path: "extra" }), ok: true },
            ],
        })).rejects.toThrow("Executive tool adapter returned 3 results for 2 calls.");

        await expect(runtime.executeScheduled(calls, {
            ...callbacks,
            execute: async (batch) => [...batch].reverse().map((item) => ({ call: item, ok: true })),
        })).rejects.toThrow("Executive tool adapter returned result 0 for a different tool call.");
    });

    test("keeps ordinary tool adapter failures as structured tool results", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const readCall = call("workspace.read", { path: "a" });
        const calls = [readCall];

        const result = await runtime.executeScheduled(calls, {
            execute: async () => {
                throw new Error("transport failed");
            },
            generate: async () => "",
            knownToolNames: () => new Set(calls.map((item) => item.key)),
            parse: () => ({ calls: [], text: "" }),
            renderResults: () => "",
            toolDescriptor: () => ({ concurrencySafe: true, exclusive: false, readOnly: true }),
        });

        expect(result).toEqual([
            {
                call: readCall,
                ok: false,
                error: "transport failed",
                result: {
                    kind: "executive-tool-error",
                    message: "transport failed",
                    tool: "workspace.read",
                },
            },
        ]);
    });

    test("rejects invalid loop budget instead of silently widening it", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        await expect(runtime.run({
            initialMessages: [],
            maxTurns: 0,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) => batch.map((item) => ({ call: item, ok: true })),
                generate: async () => "done",
                knownToolNames: () => new Set(),
                parse: (raw) => ({ calls: [], text: raw }),
                renderResults: () => "",
                toolDescriptor: () => undefined,
            },
        })).rejects.toThrow("Executive tool runtime budget.modelToolTurnBudget must be a positive integer.");
    });

    test("unknown tools are executed once so adapters can return catalog failures, then loop guard blocks repeats", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const blocked: ExecutiveLoopGuardDecision[] = [];

        const result = await runtime.run({
            initialMessages: [],
            loopGuard: { maxUnknownToolRepeats: 1 },
            maxTurns: 4,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) =>
                    batch.map((item) => ({
                        call: item,
                        ok: false,
                        error: `not available: ${item.key}`,
                    })),
                generate: async (_messages, turn) => (turn < 2 ? "missing" : "done"),
                knownToolNames: () => new Set(["workspace.read"]),
                onLoopGuardBlocked: (item, decision) => {
                    blocked.push(decision);
                    return {
                        call: item,
                        ok: false,
                        error: decision.message,
                        result: { reason: decision.reason },
                    };
                },
                parse: (raw) =>
                    raw === "missing"
                        ? { text: "", calls: [call("missing.tool", { id: 1 })] }
                        : { text: raw, calls: [] },
                renderResults: (executions) => JSON.stringify(executions),
                toolDescriptor: () => undefined,
            },
        });

        expect(result.askRequired).toEqual(expect.objectContaining({
            loopGuardReason: ExecutiveLoopGuardReason.UnknownToolRepeat,
            loopGuardSnapshot: expect.objectContaining({
                totalCalls: 2,
                unknownToolCounts: { "missing.tool": 2 },
            }),
            message: "Executive loop guard blocked every tool call in this step.",
            pause: expect.objectContaining({ mode: "pause" }),
            resume: { mode: "continue" },
            stepCount: 2,
            stop: "ask",
        }));
        expect(result.rawText).toBe("missing");
        expect(result.executions.map((execution) => execution.error)).toEqual([
            "not available: missing.tool",
            "Executive loop stopped repeated unknown tool missing.tool.",
        ]);
        expect(blocked[0]?.reason).toBe(ExecutiveLoopGuardReason.UnknownToolRepeat);
    });

    test("records failed result repeats and pauses with a structured guard snapshot", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const transcriptSizes: number[] = [];

        const result = await runtime.run({
            initialMessages: [{ role: "user", content: "start" }],
            maxTurns: 4,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) =>
                    batch.map((item) => ({
                        call: item,
                        ok: false,
                        error: "same failure",
                    })),
                generate: async (messages, turn) => {
                    transcriptSizes.push(messages.length);
                    return turn < 3 ? "again" : "final";
                },
                knownToolNames: () => new Set(["workspace.read"]),
                parse: (raw) =>
                    raw === "again"
                        ? { text: "", calls: [call("workspace.read", { path: "same" })] }
                        : { text: raw, calls: [] },
                renderResults: (executions) => JSON.stringify({ results: executions.map((item) => item.error) }),
                toolDescriptor: () => ({ concurrencySafe: true, exclusive: false, readOnly: true }),
            },
        });

        expect(result.rawText).toBe("again");
        expect(result.askRequired).toEqual(expect.objectContaining({
            loopGuardReason: ExecutiveLoopGuardReason.FailedCallRepeat,
            loopGuardSnapshot: expect.objectContaining({
                failedCallRepeatCounts: expect.any(Object),
                totalCalls: 3,
            }),
            message: "Executive loop guard blocked tool execution results in this step.",
            pause: expect.objectContaining({ mode: "pause" }),
            resume: { mode: "continue" },
            stepCount: 3,
            stop: "ask",
        }));
        expect(result.executions.map((execution) => execution.error)).toEqual([
            "same failure",
            "same failure",
            "same failure",
            "Executive loop stopped repeated failed call workspace.read.",
        ]);
        expect(transcriptSizes).toEqual([1, 3, 5]);
    });

    test("feeds failed visible tool attempts back to the model for recovery", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const renderedResults: string[] = [];

        const result = await runtime.run({
            initialMessages: [{ role: "user", content: "add package script" }],
            maxTurns: 3,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) =>
                    batch.map((item) => ({
                        call: item,
                        ok: false,
                        error: "workspace.edit oldText was not found.",
                    })),
                generate: async (_messages, turn) => (turn === 0 ? "I will edit first." : "Recovered final."),
                knownToolNames: () => new Set(["workspace.edit"]),
                parse: (raw) =>
                    raw === "I will edit first."
                        ? { text: raw, calls: [call("workspace.edit", { path: "package.json" })] }
                        : { text: raw, calls: [] },
                renderResults: (executions) => {
                    const rendered = JSON.stringify(executions.map((item) => item.error));
                    renderedResults.push(rendered);
                    return rendered;
                },
                toolDescriptor: (item) => descriptorFor(item.key),
            },
        });

        expect(result.askRequired).toBeUndefined();
        expect(result.rawText).toBe("Recovered final.");
        expect(result.executions).toEqual([
            expect.objectContaining({
                call: call("workspace.edit", { path: "package.json" }),
                error: "workspace.edit oldText was not found.",
                ok: false,
            }),
        ]);
        expect(renderedResults).toEqual(['["workspace.edit oldText was not found."]']);
    });

    test("returns ask-required when max tool turns are exhausted", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        const result = await runtime.run({
            initialMessages: [],
            maxTurns: 1,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) => batch.map((item) => ({ call: item, ok: true, result: { ok: true } })),
                generate: async (_messages, turn) => (turn === 0 ? "call" : "final with hidden call"),
                knownToolNames: () => new Set(["workspace.read"]),
                parse: parseTestCall,
                renderResults: (executions) => JSON.stringify(executions),
                toolDescriptor: () => ({ concurrencySafe: true, exclusive: false, readOnly: true }),
            },
        });

        expect(result.askRequired).toEqual(expect.objectContaining({
            budgetExhaustedReason: "model-tool-turn",
            loopGuardSnapshot: expect.objectContaining({ totalCalls: 1 }),
            message: "no more tools",
            pause: expect.objectContaining({ mode: "pause" }),
            resume: { mode: "continue" },
            stepCount: 1,
            stop: "ask",
            toolBudgetExhausted: true,
        }));
        expect(result.rawText).toBe("");
        expect(result.executions).toHaveLength(1);
    });

    test("returns ask-required when every call is blocked by loop guard", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        const result = await runtime.run({
            initialMessages: [],
            loopGuard: { maxUnknownToolRepeats: 0 },
            maxTurns: 2,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async () => [],
                generate: async (_messages, turn) => (turn === 0 ? "missing" : "final with hidden call"),
                knownToolNames: () => new Set(["workspace.read"]),
                parse: parseTestCall,
                renderResults: (executions) => JSON.stringify(executions),
                toolDescriptor: () => undefined,
            },
        });

        expect(result.askRequired).toEqual(expect.objectContaining({
            loopGuardReason: ExecutiveLoopGuardReason.UnknownToolRepeat,
            loopGuardSnapshot: expect.objectContaining({
                totalCalls: 1,
                unknownToolCounts: { "missing.tool": 1 },
            }),
            message: "Executive loop guard blocked every tool call in this step.",
            pause: expect.objectContaining({ mode: "pause" }),
            resume: { mode: "continue" },
            stepCount: 1,
            stop: "ask",
        }));
        expect(result.rawText).toBe("missing");
        expect(result.executions).toHaveLength(1);
        expect(result.executions[0]?.error).toBe("Executive loop stopped repeated unknown tool missing.tool.");
    });

    test("returns ask-required with tool budget exhausted when max turns are spent", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        const result = await runtime.run({
            initialMessages: [],
            maxTurns: 1,
            noMoreToolsMessage: "tool budget is exhausted, ask for execution guidance",
            callbacks: {
                execute: async (batch) => batch.map((item) => ({ call: item, ok: true, result: { ok: true } })),
                generate: async () => "call",
                knownToolNames: () => new Set(["workspace.read"]),
                onLoopGuardBlocked: (item, decision) => ({
                    call: item,
                    ok: false,
                    error: decision.message,
                    result: { reason: decision.reason },
                }),
                parse: () => ({ text: "", calls: [call("workspace.read", { path: "a" })] }),
                renderResults: () => "",
                toolDescriptor: () => ({ concurrencySafe: true, exclusive: false, readOnly: true }),
            },
        });

        expect(result.askRequired).toEqual(expect.objectContaining({
            budgetExhaustedReason: "model-tool-turn",
            loopGuardSnapshot: expect.objectContaining({ totalCalls: 1 }),
            message: "tool budget is exhausted, ask for execution guidance",
            pause: expect.objectContaining({ mode: "pause" }),
            resume: { mode: "continue" },
            stepCount: 1,
            stop: "ask",
            toolBudgetExhausted: true,
        }));
        expect(result.rawText).toBe("");
    });

    test("lets runtime promote structured execution results into ask-required", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        const result = await runtime.run({
            initialMessages: [],
            maxTurns: 2,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) =>
                    batch.map((item) => ({
                        call: item,
                        ok: false,
                        error: "child needs user",
                        result: { kind: "subagent-needs-user" },
                    })),
                generate: async () => "batch",
                knownToolNames: () => new Set(["subagent.batch"]),
                onExecutionAskRequired: (_execution, context) => ({
                    askId: "ask-from-execution",
                    budget: context.budget,
                    crystalCandidate: {
                        kind: "executive-loop-pause",
                        reason: "subagent-needs-user",
                        summary: "child needs user",
                    },
                    loopGuardSnapshot: context.loopGuardSnapshot,
                    message: "child needs user",
                    pause: {
                        mode: "pause",
                        options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
                    },
                    resume: { mode: "continue" },
                    stepCount: context.stepCount,
                    stop: "ask",
                }),
                parse: () => ({ text: "", calls: [call("subagent.batch", { tasks: [{ id: "blocked" }] })] }),
                renderResults: () => "",
                toolDescriptor: () => ({
                    batchBudgetUnit: "batch",
                    concurrencySafe: true,
                    exclusive: false,
                    readOnly: true,
                }),
            },
        });

        expect(result.askRequired).toEqual(expect.objectContaining({
            askId: "ask-from-execution",
            message: "child needs user",
            stepCount: 1,
            stop: "ask",
        }));
        expect(result.rawText).toBe("batch");
        expect(result.executions).toHaveLength(1);
    });

    test("separates model turns, execution operations, and risk quota in budget pauses", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();
        const executions: TestToolExecution[] = [];

        const result = await runtime.run({
            budget: {
                executionOperationBudget: 3,
                modelToolTurnBudget: 4,
                riskQuota: 1,
            },
            initialMessages: [],
            maxTurns: 4,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) => batch.map((item) => ({ call: item, ok: true, result: { ok: true } })),
                generate: async () => "call",
                knownToolNames: () => new Set(["workspace.read", "shell.run"]),
                onExecution: (execution) => executions.push(execution),
                parse: () => ({
                    text: "",
                    calls: [
                        call("workspace.read", { path: "a" }),
                        call("shell.run", { command: "one" }),
                        call("shell.run", { command: "two" }),
                    ],
                }),
                renderResults: () => "",
                toolDescriptor: (item) => descriptorFor(item.key),
            },
        });

        expect(result.askRequired).toEqual(
            expect.objectContaining({
                budget: expect.objectContaining({
                    executionOperationBudget: 3,
                    executionOperationsUsed: 2,
                    modelToolTurnBudget: 4,
                    modelToolTurnsUsed: 1,
                    riskQuota: 1,
                    riskUsed: 1,
                }),
                budgetExhaustedReason: "risk-quota",
                crystalCandidate: expect.objectContaining({
                    kind: "executive-loop-pause",
                    reason: "risk-quota",
                }),
                pause: {
                    mode: "pause",
                    options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
                },
                resume: { mode: "continue" },
                stop: "ask",
                toolBudgetExhausted: true,
            }),
        );
        expect(result.executions.map((execution) => execution.call.key)).toEqual([
            "workspace.read",
            "shell.run",
            "shell.run",
        ]);
        expect(result.executions.at(-1)?.result).toEqual(
            expect.objectContaining({
                kind: "executive-tool-budget",
                reason: "risk-quota",
                tool: "shell.run",
            }),
        );
        expect(executions).toContainEqual(expect.objectContaining({ ok: false, call: call("shell.run", { command: "two" }) }));
    });

    test("charges adjacent batch-budget fan-out calls as one parent operation", async () => {
        const runtime = new ExecutiveToolRuntime<TestToolCall, TestToolExecution>();

        const result = await runtime.run({
            budget: {
                executionOperationBudget: 1,
                modelToolTurnBudget: 2,
            },
            initialMessages: [],
            maxTurns: 2,
            noMoreToolsMessage: "no more tools",
            callbacks: {
                execute: async (batch) => batch.map((item) => ({ call: item, ok: true, result: { ok: true } })),
                generate: async () => "batch",
                knownToolNames: () => new Set(["subagent.batch", "workspace.read"]),
                parse: () => ({
                    text: "",
                    calls: [
                        call("subagent.batch", { tasks: [{ id: "a" }] }),
                        call("subagent.batch", { tasks: [{ id: "b" }] }),
                        call("workspace.read", { path: "after-batch" }),
                    ],
                }),
                renderResults: () => "",
                toolDescriptor: (item) =>
                    item.key === "subagent.batch"
                        ? {
                              batchBudgetUnit: "batch",
                              concurrencySafe: true,
                              exclusive: false,
                              readOnly: true,
                          }
                        : descriptorFor(item.key),
            },
        });

        expect(result.executions).toHaveLength(3);
        expect(result.executions.at(-1)?.result).toEqual(
            expect.objectContaining({
                kind: "executive-tool-budget",
                reason: "execution-operation",
                tool: "workspace.read",
            }),
        );
        expect(result.askRequired?.budget).toEqual(
            expect.objectContaining({
                executionOperationBudget: 1,
                executionOperationsUsed: 1,
            }),
        );
        expect(result.askRequired?.budgetExhaustedReason).toBe("execution-operation");
    });
});

function call(key: string, input: Readonly<Record<string, unknown>>): TestToolCall {
    return { key, input };
}

function descriptorFor(key: string) {
    if (key === "workspace.write") return { concurrencySafe: false, exclusive: false, readOnly: false };
    if (key === "shell.run") return { concurrencySafe: false, exclusive: true, readOnly: false };
    return { concurrencySafe: true, exclusive: false, readOnly: true };
}

function parseTestCall(raw: string): { calls: TestToolCall[]; text: string } {
    if (raw === "call") return { text: "", calls: [call("workspace.read", { path: "a" })] };
    if (raw === "missing") return { text: "", calls: [call("missing.tool", { id: 1 })] };
    if (raw === "final with hidden call") return { text: "final answer", calls: [call("workspace.read", { path: "b" })] };
    return { text: raw, calls: [] };
}

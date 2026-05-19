import { CttlLoopGuardReason } from "../protocol/contracts/index.ts";
import { CttlLoopGuard } from "./loop.guard.ts";
import type { CttlLoopGuardDecision } from "./types.ts";

export interface ExecutiveToolCall {
    readonly input: Readonly<Record<string, unknown>>;
    readonly key: string;
}

export interface ExecutiveToolExecution<TCall extends ExecutiveToolCall = ExecutiveToolCall> {
    readonly call: TCall;
    readonly error?: string;
    readonly ok: boolean;
    readonly result?: unknown;
}

export interface ExecutiveToolRuntimeDescriptor {
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly readOnly: boolean;
}

export interface ExecutiveToolRuntimeCallbacks<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    execute(calls: TCall[]): Promise<TExecution[]>;
    generate(messages: unknown[], turn: number): Promise<string>;
    knownToolNames(): ReadonlySet<string>;
    onExecution?(execution: TExecution, options: { loopGuardBlocked: boolean }): void;
    onLoopGuardBlocked?(call: TCall, decision: CttlLoopGuardDecision): TExecution;
    parse(raw: string): { calls: TCall[]; text: string };
    renderResults(executions: TExecution[]): string;
    toolDescriptor(call: TCall): ExecutiveToolRuntimeDescriptor | undefined;
}

export interface ExecutiveToolRuntimeOptions<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>;
    initialMessages: unknown[];
    loopGuard?: {
        maxUnknownToolRepeats?: number;
    };
    maxTurns: number;
    noMoreToolsMessage: string;
}

export interface ExecutiveToolRuntimeAskRequired {
    readonly askId: string;
    readonly loopGuardReason?: CttlLoopGuardReason;
    readonly message: string;
    readonly resume: {
        readonly mode: "continue";
        readonly requestId?: string;
    };
    readonly stepCount: number;
    readonly stop: "ask";
    readonly toolBudgetExhausted?: true;
}

export interface ExecutiveToolRuntimeResult<TExecution extends ExecutiveToolExecution> {
    readonly askRequired?: ExecutiveToolRuntimeAskRequired;
    executions: TExecution[];
    rawText: string;
}

/**
 * Executive owner for the model-tool loop.
 *
 * It only understands structured tool calls, descriptors, loop guard state and
 * execution scheduling. Concrete transports (MCP, shell, user tools, plugins)
 * stay behind callbacks so Executive does not import Runtime or gateway code.
 */
export class ExecutiveToolRuntime<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    public async run(input: ExecutiveToolRuntimeOptions<TCall, TExecution>): Promise<ExecutiveToolRuntimeResult<TExecution>> {
        const maxTurns = this.assertPositiveInt(input.maxTurns, "maxTurns");
        if (input.noMoreToolsMessage.length === 0) {
            throw new Error("Executive tool runtime requires a non-empty noMoreToolsMessage.");
        }
        const allExecutions: TExecution[] = [];
        const transcript = [...input.initialMessages];
        const loopGuard = new CttlLoopGuard(input.loopGuard);

        for (let turn = 0; turn < maxTurns; turn += 1) {
            const raw = await input.callbacks.generate(transcript, turn);
            const parsed = input.callbacks.parse(raw);
            if (parsed.calls.length === 0) {
                return { rawText: parsed.text || raw, executions: allExecutions };
            }

            const { allowed, blocked } = this.applyLoopGuard(parsed.calls, loopGuard, input.callbacks);
            for (const execution of blocked) {
                input.callbacks.onExecution?.(execution, { loopGuardBlocked: true });
            }
            if (allowed.length === 0) {
                if (blocked.length === 0) {
                    return { rawText: parsed.text || raw, executions: allExecutions };
                }
                allExecutions.push(...blocked);
                return {
                    askRequired: {
                        askId: crypto.randomUUID(),
                        loopGuardReason: this.lastLoopGuardReason(blocked),
                        message: "Executive loop guard blocked every tool call in this step.",
                        resume: { mode: "continue" },
                        stepCount: turn + 1,
                        stop: "ask",
                    },
                    rawText: parsed.text || raw,
                    executions: allExecutions,
                };
            }

            const executions = await this.executeScheduled(allowed, input.callbacks);
            const resultBlocked = this.applyResultGuard(executions, loopGuard, input.callbacks);
            for (const execution of resultBlocked) {
                input.callbacks.onExecution?.(execution, { loopGuardBlocked: true });
            }

            allExecutions.push(...blocked, ...executions, ...resultBlocked);
            // If the model already emitted visible text and every concrete
            // execution in this step failed, keep the user-facing reply instead
            // of turning ordinary denials/schema failures into a guard ask.
            if (parsed.text.length > 0 && executions.length > 0 && executions.every((execution) => !execution.ok)) {
                return { rawText: parsed.text, executions: allExecutions };
            }
            transcript.push(
                this.assistantMessage(parsed.text || raw),
                this.toolResultMessage(input.callbacks.renderResults([...blocked, ...executions, ...resultBlocked])),
            );
        }

        return {
            askRequired: {
                askId: crypto.randomUUID(),
                loopGuardReason: this.lastLoopGuardReason(allExecutions),
                message: input.noMoreToolsMessage,
                resume: { mode: "continue" },
                stepCount: maxTurns,
                stop: "ask",
                toolBudgetExhausted: true,
            },
            rawText: "",
            executions: allExecutions,
        };
    }

    private applyLoopGuard(
        calls: TCall[],
        loopGuard: CttlLoopGuard,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): { allowed: TCall[]; blocked: TExecution[] } {
        const knownToolNames = callbacks.knownToolNames();
        const allowed: TCall[] = [];
        const blocked: TExecution[] = [];
        for (const call of calls) {
            const decision = loopGuard.inspect({
                input: call.input,
                knownToolNames,
                toolName: call.key,
            });
            if (decision.allow) {
                allowed.push(call);
                continue;
            }
            blocked.push(this.blockedExecution(call, decision, callbacks));
        }
        return { allowed, blocked };
    }

    private applyResultGuard(
        executions: TExecution[],
        loopGuard: CttlLoopGuard,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): TExecution[] {
        return executions
            .map((execution) => ({
                execution,
                decision: loopGuard.recordResult({
                    error: execution.error,
                    input: execution.call.input,
                    ok: execution.ok,
                    toolName: execution.call.key,
                }),
            }))
            .filter((entry) => !entry.decision.allow)
            .map((entry) => this.blockedExecution(entry.execution.call, entry.decision, callbacks));
    }

    public async executeScheduled(
        calls: readonly TCall[],
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): Promise<TExecution[]> {
        const executions: TExecution[] = [];
        let batch: TCall[] = [];
        const flush = async (): Promise<void> => {
            if (batch.length === 0) return;
            const current = batch;
            batch = [];
            const batchExecutions = await this.executeBatch(current, callbacks);
            for (const execution of batchExecutions) {
                callbacks.onExecution?.(execution, { loopGuardBlocked: false });
            }
            executions.push(...batchExecutions);
        };

        for (const call of calls) {
            const descriptor = callbacks.toolDescriptor(call);
            const canBatch = descriptor?.readOnly === true && descriptor.concurrencySafe === true && descriptor.exclusive !== true;
            if (canBatch) {
                batch.push(call);
                continue;
            }
            await flush();
            const single = await this.executeBatch([call], callbacks);
            for (const execution of single) {
                callbacks.onExecution?.(execution, { loopGuardBlocked: false });
            }
            executions.push(...single);
        }
        await flush();
        return executions;
    }

    private async executeBatch(
        calls: readonly TCall[],
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): Promise<TExecution[]> {
        const executions = await callbacks.execute([...calls]);
        this.assertExecutionCoverage(calls, executions);
        return executions;
    }

    /**
     * Tool adapters are the side-effect boundary. The Executive loop refuses
     * missing, extra or reordered results so a tool call cannot disappear from
     * the event/result stream.
     */
    private assertExecutionCoverage(calls: readonly TCall[], executions: readonly TExecution[]): void {
        if (executions.length !== calls.length) {
            throw new Error(`Executive tool adapter returned ${executions.length} results for ${calls.length} calls.`);
        }
        calls.forEach((call, index) => {
            const execution = executions[index];
            if (!execution) {
                throw new Error(`Executive tool adapter omitted result ${index} for ${call.key}.`);
            }
            if (execution.call.key !== call.key || this.stableJson(execution.call.input) !== this.stableJson(call.input)) {
                throw new Error(`Executive tool adapter returned result ${index} for a different tool call.`);
            }
        });
    }

    private assertPositiveInt(value: number, path: string): number {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`Executive tool runtime ${path} must be a positive integer.`);
        }
        return value;
    }

    private blockedExecution(
        call: TCall,
        decision: CttlLoopGuardDecision,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): TExecution {
        const execution = callbacks.onLoopGuardBlocked?.(call, decision);
        if (execution) return execution;
        return {
            call,
            ok: false,
            error: decision.message ?? "Executive loop guard blocked this tool call.",
            result: {
                kind: "cttl-loop-guard",
                message: decision.message,
                reason: decision.reason ?? CttlLoopGuardReason.RepeatedCallNoProgress,
                tool: call.key,
            },
        } as TExecution;
    }

    private assistantMessage(content: string): unknown {
        return { role: "assistant", content };
    }

    private toolResultMessage(content: string): unknown {
        return { role: "user", content };
    }

    private lastLoopGuardReason(executions: readonly TExecution[]): CttlLoopGuardReason | undefined {
        for (const execution of [...executions].reverse()) {
            if (!execution.result || typeof execution.result !== "object") continue;
            const reason = this.loopGuardReasonFromResult(execution.result);
            if (reason) return reason;
        }
        return undefined;
    }

    private loopGuardReasonFromResult(value: object): CttlLoopGuardReason | undefined {
        const reason = (value as { reason?: unknown; raw?: unknown }).reason;
        if (this.isLoopGuardReason(reason)) return reason;
        const raw = (value as { raw?: unknown }).raw;
        if (raw && typeof raw === "object") {
            const rawReason = (raw as { reason?: unknown }).reason;
            if (this.isLoopGuardReason(rawReason)) return rawReason;
        }
        return undefined;
    }

    private isLoopGuardReason(value: unknown): value is CttlLoopGuardReason {
        return Object.values(CttlLoopGuardReason).includes(value as CttlLoopGuardReason);
    }

    private stableJson(value: unknown): string {
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((entry) => this.stableJson(entry)).join(",")}]`;
        }
        const record = value as Record<string, unknown>;
        const entries = Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`);
        return `{${entries.join(",")}}`;
    }
}

import { ExecutiveLoopGuardReason } from "../protocol/contracts/index.ts";
import type { ExecutionJobSnapshot } from "./job/index.ts";
import { ExecutiveLoopGuard } from "./loop.guard.ts";
import type { ExecutiveLoopGuardDecision, ExecutiveLoopGuardSnapshot } from "./types.ts";

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
    /** Batched fan-out calls can consume one parent execution operation while preserving per-child results. */
    readonly batchBudgetUnit?: "batch";
    readonly concurrencySafe: boolean;
    readonly exclusive: boolean;
    readonly readOnly: boolean;
    /** High-risk calls consume the independent risk quota before execution. */
    readonly risk?: "low" | "high";
}

export const ExecutiveToolBudgetExhaustedReason = {
    ExecutionOperation: "execution-operation",
    ModelToolTurn: "model-tool-turn",
    RiskQuota: "risk-quota",
} as const;

export type ExecutiveToolBudgetExhaustedReason =
    (typeof ExecutiveToolBudgetExhaustedReason)[keyof typeof ExecutiveToolBudgetExhaustedReason];

export interface ExecutiveToolRuntimeBudget {
    readonly executionOperationBudget?: number;
    readonly modelToolTurnBudget?: number;
    readonly riskQuota?: number;
}

export interface ExecutiveToolRuntimeBudgetSnapshot {
    readonly executionOperationBudget: number;
    readonly executionOperationsRemaining: number;
    readonly executionOperationsUsed: number;
    readonly modelToolTurnBudget: number;
    readonly modelToolTurnsRemaining: number;
    readonly modelToolTurnsUsed: number;
    readonly riskQuota: number;
    readonly riskRemaining: number;
    readonly riskUsed: number;
}

export interface ExecutiveToolRuntimeBudgetDecision {
    readonly allow: boolean;
    readonly budget: ExecutiveToolRuntimeBudgetSnapshot;
    readonly message: string;
    readonly reason: ExecutiveToolBudgetExhaustedReason;
}

export interface ExecutiveToolRuntimeCallbacks<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    execute(calls: TCall[]): Promise<TExecution[]>;
    generate(messages: unknown[], turn: number): Promise<string>;
    knownToolNames(): ReadonlySet<string>;
    onBudgetBlocked?(call: TCall, decision: ExecutiveToolRuntimeBudgetDecision): TExecution;
    onExecution?(execution: TExecution, options: { loopGuardBlocked: boolean }): void;
    onExecutionAskRequired?(
        execution: TExecution,
        context: {
            budget: ExecutiveToolRuntimeBudgetSnapshot;
            loopGuardSnapshot: ExecutiveLoopGuardSnapshot;
            stepCount: number;
        },
    ): ExecutiveToolRuntimeAskRequired | undefined;
    onLoopGuardBlocked?(call: TCall, decision: ExecutiveLoopGuardDecision): TExecution;
    parse(raw: string): { calls: TCall[]; text: string };
    renderResults(executions: TExecution[]): string;
    toolDescriptor(call: TCall): ExecutiveToolRuntimeDescriptor | undefined;
}

export interface ExecutiveToolRuntimeOptions<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    budget?: ExecutiveToolRuntimeBudget;
    callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>;
    initialMessages: unknown[];
    loopGuard?: {
        maxCalls?: number;
        maxFailedCallRepeats?: number;
        maxRepeatedCalls?: number;
        maxUnknownToolRepeats?: number;
    };
    maxTurns: number;
    noMoreToolsMessage: string;
}

export interface ExecutiveToolRuntimeAskRequired {
    readonly askId: string;
    readonly budget?: ExecutiveToolRuntimeBudgetSnapshot;
    readonly budgetExhaustedReason?: ExecutiveToolBudgetExhaustedReason;
    readonly crystalCandidate: {
        readonly kind: "executive-loop-pause";
        readonly reason: string;
        readonly summary: string;
    };
    readonly loopGuardReason?: ExecutiveLoopGuardReason;
    readonly loopGuardSnapshot?: ExecutiveLoopGuardSnapshot;
    readonly job?: ExecutionJobSnapshot;
    readonly jobId?: string;
    readonly message: string;
    readonly toolStability?: Record<string, unknown>;
    readonly pause: {
        readonly mode: "pause";
        readonly options: readonly [
            { readonly mode: "continue" },
            { readonly mode: "narrow" },
            { readonly mode: "stop" },
        ];
    };
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
 * stay behind callbacks so Executive does not import Runtime or socket code.
 */
export class ExecutiveToolRuntime<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>> {
    public async run(input: ExecutiveToolRuntimeOptions<TCall, TExecution>): Promise<ExecutiveToolRuntimeResult<TExecution>> {
        const maxTurns = this.assertPositiveInt(input.budget?.modelToolTurnBudget ?? input.maxTurns, "budget.modelToolTurnBudget");
        if (input.noMoreToolsMessage.length === 0) {
            throw new Error("Executive tool runtime requires a non-empty noMoreToolsMessage.");
        }
        const allExecutions: TExecution[] = [];
        const transcript = [...input.initialMessages];
        const loopGuard = new ExecutiveLoopGuard(input.loopGuard);
        const budget = new ExecutiveToolBudgetState({
            executionOperationBudget: input.budget?.executionOperationBudget,
            modelToolTurnBudget: maxTurns,
            riskQuota: input.budget?.riskQuota,
        });

        for (let turn = 0; turn < maxTurns; turn += 1) {
            const raw = await input.callbacks.generate(transcript, turn);
            const parsed = input.callbacks.parse(raw);
            if (parsed.calls.length === 0) {
                return { rawText: parsed.text || raw, executions: allExecutions };
            }
            budget.consumeModelToolTurn();

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
                        budget: budget.snapshot(),
                        crystalCandidate: this.crystalCandidate("loop-guard", "Executive loop guard blocked every tool call in this step."),
                        loopGuardReason: this.lastLoopGuardReason(blocked),
                        loopGuardSnapshot: loopGuard.snapshot(),
                        message: "Executive loop guard blocked every tool call in this step.",
                        pause: this.pausePayload(),
                        resume: { mode: "continue" },
                        stepCount: turn + 1,
                        stop: "ask",
                    },
                    rawText: parsed.text || raw,
                    executions: allExecutions,
                };
            }

            const budgeted = this.applyBudget(allowed, budget, input.callbacks);
            for (const execution of budgeted.blocked) {
                input.callbacks.onExecution?.(execution, { loopGuardBlocked: false });
            }
            const executions = await this.executeScheduled(budgeted.allowed, input.callbacks);
            const resultBlocked = this.applyResultGuard(executions, loopGuard, input.callbacks);
            for (const execution of resultBlocked) {
                input.callbacks.onExecution?.(execution, { loopGuardBlocked: true });
            }

            allExecutions.push(...blocked, ...executions, ...budgeted.blocked, ...resultBlocked);
            const executionAsk = this.firstExecutionAskRequired(
                [...executions, ...budgeted.blocked, ...resultBlocked],
                input.callbacks,
                budget.snapshot(),
                loopGuard.snapshot(),
                turn + 1,
            );
            if (executionAsk) {
                return {
                    askRequired: executionAsk,
                    rawText: parsed.text || raw,
                    executions: allExecutions,
                };
            }
            if (budgeted.blocked.length > 0) {
                const decision = budgeted.decisions.at(-1);
                const message = decision?.message ?? "Executive tool budget was exhausted.";
                return {
                    askRequired: {
                        askId: crypto.randomUUID(),
                        budget: budget.snapshot(),
                        budgetExhaustedReason: decision?.reason,
                        crystalCandidate: this.crystalCandidate(decision?.reason ?? "budget", message),
                        loopGuardReason: this.lastLoopGuardReason(resultBlocked),
                        loopGuardSnapshot: loopGuard.snapshot(),
                        message,
                        pause: this.pausePayload(),
                        resume: { mode: "continue" },
                        stepCount: turn + 1,
                        stop: "ask",
                        toolBudgetExhausted: true,
                    },
                    rawText: parsed.text || raw,
                    executions: allExecutions,
                };
            }
            if (resultBlocked.length > 0) {
                return {
                    askRequired: {
                        askId: crypto.randomUUID(),
                        budget: budget.snapshot(),
                        crystalCandidate: this.crystalCandidate("loop-guard", "Executive loop guard blocked tool execution results in this step."),
                        loopGuardReason: this.lastLoopGuardReason(resultBlocked),
                        loopGuardSnapshot: loopGuard.snapshot(),
                        message: "Executive loop guard blocked tool execution results in this step.",
                        pause: this.pausePayload(),
                        resume: { mode: "continue" },
                        stepCount: turn + 1,
                        stop: "ask",
                    },
                    rawText: parsed.text || raw,
                    executions: allExecutions,
                };
            }
            transcript.push(
                this.assistantMessage(parsed.text || raw),
                this.toolResultMessage(input.callbacks.renderResults([...blocked, ...executions, ...resultBlocked])),
            );
        }

        return {
            askRequired: {
                askId: crypto.randomUUID(),
                budget: budget.snapshot(),
                budgetExhaustedReason: ExecutiveToolBudgetExhaustedReason.ModelToolTurn,
                crystalCandidate: this.crystalCandidate(ExecutiveToolBudgetExhaustedReason.ModelToolTurn, input.noMoreToolsMessage),
                loopGuardReason: this.lastLoopGuardReason(allExecutions),
                loopGuardSnapshot: loopGuard.snapshot(),
                message: input.noMoreToolsMessage,
                pause: this.pausePayload(),
                resume: { mode: "continue" },
                stepCount: maxTurns,
                stop: "ask",
                toolBudgetExhausted: true,
            },
            rawText: "",
            executions: allExecutions,
        };
    }

    private firstExecutionAskRequired<TCall extends ExecutiveToolCall, TExecution extends ExecutiveToolExecution<TCall>>(
        executions: readonly TExecution[],
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
        budget: ExecutiveToolRuntimeBudgetSnapshot,
        loopGuardSnapshot: ExecutiveLoopGuardSnapshot,
        stepCount: number,
    ): ExecutiveToolRuntimeAskRequired | undefined {
        if (!callbacks.onExecutionAskRequired) return undefined;
        for (const execution of executions) {
            const askRequired = callbacks.onExecutionAskRequired(execution, {
                budget,
                loopGuardSnapshot,
                stepCount,
            });
            if (askRequired) return askRequired;
        }
        return undefined;
    }

    private applyBudget(
        calls: TCall[],
        budget: ExecutiveToolBudgetState,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): { allowed: TCall[]; blocked: TExecution[]; decisions: ExecutiveToolRuntimeBudgetDecision[] } {
        const allowed: TCall[] = [];
        const blocked: TExecution[] = [];
        const decisions: ExecutiveToolRuntimeBudgetDecision[] = [];
        const groups = this.groupBudgetUnits(calls, callbacks);
        for (const group of groups) {
            const decision = budget.inspectExecution({ highRisk: group.highRisk });
            if (decision.allow) {
                allowed.push(...group.calls);
                continue;
            }
            decisions.push(decision);
            blocked.push(...group.calls.map((call) => this.budgetBlockedExecution(call, decision, callbacks)));
        }
        return { allowed, blocked, decisions };
    }

    /**
     * Some tools are themselves controlled fan-out schedulers. Their descriptor
     * can declare `batchBudgetUnit` so the parent loop accounts for the outer
     * operation once while the tool preserves child-level loop guards/results.
     */
    private groupBudgetUnits(
        calls: TCall[],
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): Array<{ calls: TCall[]; highRisk: boolean }> {
        const groups: Array<{ calls: TCall[]; highRisk: boolean }> = [];
        let batch: TCall[] = [];
        let batchHighRisk = false;
        const flush = (): void => {
            if (batch.length === 0) return;
            groups.push({ calls: batch, highRisk: batchHighRisk });
            batch = [];
            batchHighRisk = false;
        };
        for (const call of calls) {
            const descriptor = callbacks.toolDescriptor(call);
            const highRisk = descriptor?.risk === "high" || descriptor?.readOnly === false || descriptor?.exclusive === true;
            if (descriptor?.batchBudgetUnit === "batch") {
                batch.push(call);
                batchHighRisk = batchHighRisk || highRisk;
                continue;
            }
            flush();
            groups.push({ calls: [call], highRisk });
        }
        flush();
        return groups;
    }

    private applyLoopGuard(
        calls: TCall[],
        loopGuard: ExecutiveLoopGuard,
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
        loopGuard: ExecutiveLoopGuard,
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
        let executions: TExecution[];
        try {
            executions = await callbacks.execute([...calls]);
        } catch (error) {
            return calls.map((call) => this.toolFailureExecution(call, error));
        }
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
        decision: ExecutiveLoopGuardDecision,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): TExecution {
        const execution = callbacks.onLoopGuardBlocked?.(call, decision);
        if (execution) return execution;
        return {
            call,
            ok: false,
            error: decision.message ?? "Executive loop guard blocked this tool call.",
            result: {
                kind: "executive-loop-guard",
                message: decision.message,
                reason: decision.reason ?? ExecutiveLoopGuardReason.RepeatedCallNoProgress,
                tool: call.key,
            },
        } as TExecution;
    }

    private budgetBlockedExecution(
        call: TCall,
        decision: ExecutiveToolRuntimeBudgetDecision,
        callbacks: ExecutiveToolRuntimeCallbacks<TCall, TExecution>,
    ): TExecution {
        const execution = callbacks.onBudgetBlocked?.(call, decision);
        if (execution) return execution;
        return {
            call,
            ok: false,
            error: decision.message,
            result: {
                budget: decision.budget,
                kind: "executive-tool-budget",
                message: decision.message,
                reason: decision.reason,
                tool: call.key,
            },
        } as TExecution;
    }

    private toolFailureExecution(call: TCall, error: unknown): TExecution {
        const message = error instanceof Error ? error.message : String(error);
        return {
            call,
            ok: false,
            error: message,
            result: {
                kind: "executive-tool-error",
                message,
                tool: call.key,
            },
        } as TExecution;
    }

    private pausePayload(): ExecutiveToolRuntimeAskRequired["pause"] {
        return {
            mode: "pause",
            options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
        };
    }

    private crystalCandidate(reason: string, summary: string): ExecutiveToolRuntimeAskRequired["crystalCandidate"] {
        return {
            kind: "executive-loop-pause",
            reason,
            summary,
        };
    }

    private assistantMessage(content: string): unknown {
        return { role: "assistant", content };
    }

    private toolResultMessage(content: string): unknown {
        return { role: "user", content };
    }

    private lastLoopGuardReason(executions: readonly TExecution[]): ExecutiveLoopGuardReason | undefined {
        for (const execution of [...executions].reverse()) {
            if (!execution.result || typeof execution.result !== "object") continue;
            const reason = this.loopGuardReasonFromResult(execution.result);
            if (reason) return reason;
        }
        return undefined;
    }

    private loopGuardReasonFromResult(value: object): ExecutiveLoopGuardReason | undefined {
        const reason = (value as { reason?: unknown; raw?: unknown }).reason;
        if (this.isLoopGuardReason(reason)) return reason;
        const raw = (value as { raw?: unknown }).raw;
        if (raw && typeof raw === "object") {
            const rawReason = (raw as { reason?: unknown }).reason;
            if (this.isLoopGuardReason(rawReason)) return rawReason;
        }
        return undefined;
    }

    private isLoopGuardReason(value: unknown): value is ExecutiveLoopGuardReason {
        return Object.values(ExecutiveLoopGuardReason).includes(value as ExecutiveLoopGuardReason);
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

class ExecutiveToolBudgetState {
    private executionOperationsUsed = 0;
    private modelToolTurnsUsed = 0;
    private riskUsed = 0;
    private readonly executionOperationBudget: number;
    private readonly modelToolTurnBudget: number;
    private readonly riskQuota: number;

    public constructor(input: Required<Pick<ExecutiveToolRuntimeBudget, "modelToolTurnBudget">> & ExecutiveToolRuntimeBudget) {
        this.modelToolTurnBudget = this.assertNonNegativeInt(input.modelToolTurnBudget, "budget.modelToolTurnBudget");
        this.executionOperationBudget = this.assertNonNegativeInt(
            input.executionOperationBudget ?? Number.MAX_SAFE_INTEGER,
            "budget.executionOperationBudget",
        );
        this.riskQuota = this.assertNonNegativeInt(input.riskQuota ?? Number.MAX_SAFE_INTEGER, "budget.riskQuota");
    }

    public consumeModelToolTurn(): void {
        this.modelToolTurnsUsed += 1;
    }

    public inspectExecution(input: { highRisk: boolean }): ExecutiveToolRuntimeBudgetDecision {
        if (this.executionOperationsUsed >= this.executionOperationBudget) {
            return this.block(ExecutiveToolBudgetExhaustedReason.ExecutionOperation, "Executive execution operation budget is exhausted.");
        }
        if (input.highRisk && this.riskUsed >= this.riskQuota) {
            return this.block(ExecutiveToolBudgetExhaustedReason.RiskQuota, "Executive high-risk operation quota is exhausted.");
        }
        this.executionOperationsUsed += 1;
        if (input.highRisk) {
            this.riskUsed += 1;
        }
        return {
            allow: true,
            budget: this.snapshot(),
            message: "Executive budget allows this tool call.",
            reason: ExecutiveToolBudgetExhaustedReason.ExecutionOperation,
        };
    }

    public snapshot(): ExecutiveToolRuntimeBudgetSnapshot {
        return {
            executionOperationBudget: this.executionOperationBudget,
            executionOperationsRemaining: Math.max(0, this.executionOperationBudget - this.executionOperationsUsed),
            executionOperationsUsed: this.executionOperationsUsed,
            modelToolTurnBudget: this.modelToolTurnBudget,
            modelToolTurnsRemaining: Math.max(0, this.modelToolTurnBudget - this.modelToolTurnsUsed),
            modelToolTurnsUsed: this.modelToolTurnsUsed,
            riskQuota: this.riskQuota,
            riskRemaining: Math.max(0, this.riskQuota - this.riskUsed),
            riskUsed: this.riskUsed,
        };
    }

    private block(reason: ExecutiveToolBudgetExhaustedReason, message: string): ExecutiveToolRuntimeBudgetDecision {
        return {
            allow: false,
            budget: this.snapshot(),
            message,
            reason,
        };
    }

    private assertNonNegativeInt(value: number, path: string): number {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`Executive tool runtime ${path} must be a non-negative integer.`);
        }
        return value;
    }
}

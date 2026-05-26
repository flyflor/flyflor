import { Component } from "../../di/decorators/index.ts";
import { Runtime } from "../../../components/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import {
    CapabilitySource,
    ModelRole,
    ToolCategory,
    ToolPermission,
    ToolScope,
} from "../../../protocol/contracts/index.ts";
import type { ToolDescriptor } from "../../../executive/index.ts";
import type { ExecutiveJsonObject } from "../../../executive/index.ts";
import { ExecutiveToolRuntime } from "../../../executive/index.ts";
import { ExecutionJobComponent, type ExecutionJob } from "../../../executive/index.ts";
import { parseMcpToolCalls, type McpToolCallExecution, type McpToolCallRequest, type McpToolCatalogEntry } from "../../mcp/index.ts";
import {
    SUBAGENT_BATCH_KEY,
    SUBAGENT_BATCH_TOOL,
    SUBAGENT_SERVER,
    type SubagentBatchExecutorInput,
    type SubagentBatchInput,
    type SubagentBatchResult,
    type SubagentChildResult,
    type SubagentTask,
} from "./types.ts";

const DEFAULT_SUBAGENT_CONCURRENCY = 4;
const MAX_SUBAGENT_CONCURRENCY = 8;
const DEFAULT_CHILD_TOOL_TURNS = 8;
const MAX_SUBAGENT_TASKS = 24;

@Component()
export class RuntimeSubagentBatchComponent extends Runtime {
    public constructor(
        private readonly events?: EventSink,
        private readonly jobs: ExecutionJobComponent = new ExecutionJobComponent(),
    ) {
        super();
    }

    public catalogEntry(): McpToolCatalogEntry {
        return {
            server: SUBAGENT_SERVER,
            tool: {
                name: SUBAGENT_BATCH_TOOL,
                description:
                    "Run several focused helper tasks in parallel, using only a narrowed subset of this turn's available tools. Return structured child results instead of asking the user directly.",
                inputSchema: {
                    type: "object",
                    properties: {
                        concurrency: { type: "number" },
                        maxToolTurns: { type: "number" },
                        tasks: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    goal: { type: "string" },
                                    toolAllowlist: { type: "array", items: { type: "string" } },
                                },
                                required: ["goal"],
                            },
                        },
                    },
                    required: ["tasks"],
                },
            },
        };
    }

    public descriptor(): ToolDescriptor {
        return {
            category: ToolCategory.Coding,
            concurrencySafe: true,
            description: "Run focused helper tasks in parallel with a narrowed tool set.",
            exclusive: false,
            inputSchema: this.catalogEntry().tool.inputSchema as ExecutiveJsonObject,
            name: SUBAGENT_BATCH_KEY,
            permission: ToolPermission.Read,
            readOnly: true,
            resultLimit: { maxChars: 12_000 },
            scope: [ToolScope.Subagent, ToolScope.Workspace],
            source: CapabilitySource.Subagent,
            sourceId: "runtime",
            tags: ["batch", "parallel"],
        };
    }

    public readInput(input: Record<string, unknown>): { ok: true; batch: SubagentBatchInput } | { ok: false; error: string } {
        const tasks = input.tasks;
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return { ok: false, error: "subagent.batch requires input.tasks as a non-empty array." };
        }
        if (tasks.length > MAX_SUBAGENT_TASKS) {
            return { ok: false, error: `subagent.batch supports at most ${MAX_SUBAGENT_TASKS} tasks per call.` };
        }
        const normalized: SubagentTask[] = [];
        for (let index = 0; index < tasks.length; index += 1) {
            const value = tasks[index];
            if (!this.isRecord(value)) return { ok: false, error: `subagent.batch tasks.${index} must be an object.` };
            const goal = value.goal;
            if (typeof goal !== "string" || goal.trim().length === 0) {
                return { ok: false, error: `subagent.batch tasks.${index}.goal must be a non-empty string.` };
            }
            const id = value.id;
            if (id !== undefined && typeof id !== "string") {
                return { ok: false, error: `subagent.batch tasks.${index}.id must be a string.` };
            }
            const toolAllowlist = this.readToolAllowlist(value.toolAllowlist, `subagent.batch tasks.${index}.toolAllowlist`);
            if (!toolAllowlist.ok) return toolAllowlist;
            normalized.push({
                id: typeof id === "string" && id.trim() ? id.trim() : `child-${index + 1}`,
                goal: goal.trim(),
                ...(toolAllowlist.value.length > 0 ? { toolAllowlist: toolAllowlist.value } : {}),
            });
        }
        const concurrency = this.clampPositiveInt(input.concurrency, DEFAULT_SUBAGENT_CONCURRENCY, MAX_SUBAGENT_CONCURRENCY);
        const maxToolTurns = this.clampPositiveInt(input.maxToolTurns, DEFAULT_CHILD_TOOL_TURNS, DEFAULT_CHILD_TOOL_TURNS);
        return { ok: true, batch: { concurrency, maxToolTurns, tasks: normalized } };
    }

    public async run(input: SubagentBatchExecutorInput): Promise<SubagentBatchResult> {
        const batchId = crypto.randomUUID();
        const concurrency = this.clampPositiveInt(input.batch.concurrency, DEFAULT_SUBAGENT_CONCURRENCY, MAX_SUBAGENT_CONCURRENCY);
        const job = this.jobs.create({
            budget: input.parent.budget,
            childIds: input.batch.tasks.map((task, index) => task.id ?? `child-${index + 1}`),
            ownerKey: input.parent.ownerKey,
            requestId: input.parent.requestId,
            sourceKey: input.parent.sourceKey,
        });
        this.jobs.markRunning(job.jobId);
        this.events?.publish(
            event(RuntimeEventType.SubagentBatchStart, {
                batchId,
                concurrency,
                jobId: job.jobId,
                parentRequestId: input.parent.requestId,
                tasks: input.batch.tasks.length,
                taskSummaries: input.batch.tasks.map((task, index) => this.taskSummary(task, index)),
            }, input.parent.requestId),
        );
        const results = await this.mapConcurrent(input.batch.tasks, concurrency, (task, index) =>
            this.runChild(batchId, job, task, index, input),
        );
        const finishedJob = this.jobs.finish(job.jobId);
        const askResult = results.find((result) => result.askRequired);
        this.events?.publish(
            event(RuntimeEventType.SubagentBatchEnd, {
                batchId,
                completed: results.filter((result) => result.status === "completed").length,
                failed: results.filter((result) => result.status === "failed").length,
                askId: askResult?.askRequired?.askId,
                askRequired: Boolean(askResult?.askRequired),
                childJobs: results.map((result) => ({
                    childId: result.id,
                    childJobId: result.childJobId,
                    status: result.status,
                    toolCalls: result.toolCalls.length,
                    askRequired: Boolean(result.askRequired),
                })),
                crystalCandidate: Boolean(askResult?.askRequired?.crystalCandidate),
                jobId: job.jobId,
                needsUser: results.filter((result) => result.status === "needs_user").length,
                parentRequestId: input.parent.requestId,
            }, input.parent.requestId),
        );
        return {
            batchId,
            concurrency,
            job: this.jobs.snapshot(job.jobId),
            jobId: finishedJob?.jobId ?? job.jobId,
            needsUser: results.some((result) => result.status === "needs_user"),
            needsUserReason: results.find((result) => result.status === "needs_user")?.error,
            askRequired: askResult?.askRequired,
            results,
        };
    }

    private async runChild(
        batchId: string,
        job: ExecutionJob,
        task: SubagentTask,
        index: number,
        input: SubagentBatchExecutorInput,
    ): Promise<SubagentChildResult> {
        const id = task.id ?? `child-${index + 1}`;
        const childJobId = job.children[index]?.childJobId;
        const catalog = this.narrowCatalog(input.parent.catalog, task.toolAllowlist);
        const childRequestId = `${input.parent.requestId}:subagent:${batchId}:${id}`;
        const allowedTools = catalog.map((entry) => `${entry.server}.${entry.tool.name}`);
        const model = this.modelSummary(input.parent.model);
        let modelAllocationRef: string | undefined;
        if (childJobId) this.jobs.markChildRunning(job.jobId, childJobId);
        this.events?.publish(
            event(RuntimeEventType.SubagentChildStart, {
                batchId,
                childId: id,
                childJobId,
                childRequestId,
                jobId: job.jobId,
                allowedTools,
                model,
                parentRequestId: input.parent.requestId,
                task: this.taskSummary(task, index),
            }, childRequestId),
        );
        if (catalog.length === 0) {
            if (childJobId) {
                this.jobs.completeChild(job.jobId, {
                    childJobId,
                    status: "failed",
                    toolExecutions: [],
                });
            }
            this.events?.publish(
                event(RuntimeEventType.SubagentChildEnd, {
                    batchId,
                    childId: id,
                    childJobId,
                    jobId: job.jobId,
                    parentRequestId: input.parent.requestId,
                    status: "failed",
                    toolCalls: 0,
                }, childRequestId),
            );
            return {
                childJobId,
                id,
                ok: false,
                status: "failed",
                error: "No tools are available for this child task after narrowing.",
                toolCalls: [],
            };
        }
        const runtime = new ExecutiveToolRuntime<McpToolCallRequest & { key: string }, McpToolCallExecution & { call: McpToolCallRequest & { key: string } }>();
        const result = await runtime.run({
            budget: {
                executionOperationBudget: Math.max(1, input.batch.maxToolTurns ?? DEFAULT_CHILD_TOOL_TURNS),
                modelToolTurnBudget: Math.max(1, input.batch.maxToolTurns ?? DEFAULT_CHILD_TOOL_TURNS),
            },
            initialMessages: this.childMessages(input.parent.initialMessages, task, catalog),
            loopGuard: { maxUnknownToolRepeats: 0 },
            maxTurns: Math.max(1, input.batch.maxToolTurns ?? DEFAULT_CHILD_TOOL_TURNS),
            noMoreToolsMessage: "The helper task needs user guidance before it can continue.",
            callbacks: {
                execute: (calls) => input.executeCalls(calls, catalog, childRequestId),
                generate: (messages, turn) => {
                    modelAllocationRef = crypto.randomUUID();
                    this.events?.publish(
                        event(RuntimeEventType.ModelAllocationSelected, {
                            allocationId: modelAllocationRef,
                            requestId: input.parent.requestId,
                            jobId: job.jobId,
                            childId: id,
                            childJobId,
                            childRequestId,
                            scope: "subagent-child",
                            agentRole: "subagent-child",
                            providerId: model.providerId,
                            modelId: model.modelId,
                            reason: turn === 0 ? "subagent.child.generate.initial" : "subagent.child.generate.tool-loop",
                            source: model.source,
                        }, childRequestId),
                    );
                    return input.child.generate(messages, turn, task);
                },
                knownToolNames: () => new Set(catalog.map((entry) => `${entry.server}.${entry.tool.name}`)),
                parse: (raw) => {
                    const parsed = parseMcpToolCalls(raw);
                    return {
                        text: parsed.text,
                        calls: parsed.calls.map((call) => ({ ...call, key: `${call.server}.${call.tool}` })),
                    };
                },
                renderResults: input.child.renderResults,
                toolDescriptor: (call) => this.childDescriptor(call, catalog),
            },
        });
        const status = result.askRequired ? "needs_user" : result.executions.every((execution) => execution.ok) ? "completed" : "failed";
        if (childJobId) {
            this.jobs.completeChild(job.jobId, {
                askRequired: result.askRequired,
                childJobId,
                status,
                toolExecutions: result.executions.map((execution) =>
                    input.recordToolExecution
                        ? input.recordToolExecution(execution, childJobId)
                        : {
                              childJobId,
                              error: execution.error,
                              ok: execution.ok,
                              server: execution.call.server,
                              tool: execution.call.tool,
                          },
                ),
            });
        }
        this.events?.publish(
            event(RuntimeEventType.SubagentChildEnd, {
                batchId,
                childId: id,
                childJobId,
                askId: result.askRequired?.askId,
                askRequired: Boolean(result.askRequired),
                jobId: job.jobId,
                model,
                modelAllocationRef,
                parentRequestId: input.parent.requestId,
                status,
                taskId: id,
                toolCalls: result.executions.length,
                crystalCandidate: Boolean(result.askRequired?.crystalCandidate),
            }, childRequestId),
        );
        return {
            childJobId,
            id,
            ok: status === "completed",
            status,
            askRequired: result.askRequired,
            text: result.rawText || undefined,
            error: result.askRequired?.message,
            toolCalls: result.executions,
        };
    }

    private childMessages(
        parentMessages: readonly unknown[],
        task: SubagentTask,
        catalog: readonly McpToolCatalogEntry[],
    ): unknown[] {
        return [
            ...parentMessages,
            {
                role: ModelRole.User,
                content: JSON.stringify({
                    helperTask: {
                        goal: task.goal,
                        allowedTools: catalog.map((entry) => `${entry.server}.${entry.tool.name}`),
                        userDecisionPolicy: "return_needs_user_result",
                    },
                }),
            },
        ];
    }

    private childDescriptor(
        call: McpToolCallRequest,
        catalog: readonly McpToolCatalogEntry[],
    ) {
        const entry = catalog.find((candidate) => candidate.server === call.server && candidate.tool.name === call.tool);
        if (!entry) return undefined;
        return {
            concurrencySafe: this.isReadOnlyEntry(entry),
            exclusive: false,
            readOnly: this.isReadOnlyEntry(entry),
            risk: this.isReadOnlyEntry(entry) ? "low" as const : "high" as const,
        };
    }

    private narrowCatalog(
        parentCatalog: readonly McpToolCatalogEntry[],
        allowlist?: readonly string[],
    ): McpToolCatalogEntry[] {
        const available = parentCatalog.filter((entry) => `${entry.server}.${entry.tool.name}` !== SUBAGENT_BATCH_KEY);
        if (!allowlist || allowlist.length === 0) return available;
        const allowed = new Set(allowlist);
        return available.filter((entry) => allowed.has(`${entry.server}.${entry.tool.name}`));
    }

    private isReadOnlyEntry(entry: McpToolCatalogEntry): boolean {
        if (entry.server === "workspace") {
            return entry.tool.name !== "write" && entry.tool.name !== "edit" && entry.tool.name !== "delete" && entry.tool.name !== "patch";
        }
        return entry.server !== "shell" && entry.server !== "process" && entry.server !== "user";
    }

    private taskSummary(task: SubagentTask, index: number): Record<string, unknown> {
        return {
            id: task.id ?? `child-${index + 1}`,
            goal: task.goal.slice(0, 240),
            toolAllowlist: task.toolAllowlist ?? [],
        };
    }

    private modelSummary(model?: SubagentBatchExecutorInput["parent"]["model"]): { modelId: string; providerId: string; source: string } {
        return {
            modelId: model?.modelId ?? "unknown",
            providerId: model?.providerId ?? "unknown",
            source: model?.source ?? "runtime.subagent.fallback",
        };
    }

    private async mapConcurrent<T, R>(
        items: readonly T[],
        limit: number,
        run: (item: T, index: number) => Promise<R>,
    ): Promise<R[]> {
        const results = new Array<R>(items.length);
        let cursor = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await run(items[index]!, index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    private readToolAllowlist(value: unknown, path: string): { ok: true; value: string[] } | { ok: false; error: string } {
        if (value === undefined) return { ok: true, value: [] };
        if (!Array.isArray(value)) return { ok: false, error: `${path} must be a string array.` };
        const out: string[] = [];
        for (const item of value) {
            if (typeof item !== "string" || item.trim().length === 0) {
                return { ok: false, error: `${path} entries must be non-empty strings.` };
            }
            if (item.trim() !== SUBAGENT_BATCH_KEY) out.push(item.trim());
        }
        return { ok: true, value: out };
    }

    private clampPositiveInt(value: unknown, fallback: number, max: number): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
        return Math.min(value, max);
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

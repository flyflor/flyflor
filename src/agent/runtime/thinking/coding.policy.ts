import { stat } from "node:fs/promises";

import {
    AskAnswerContractKind,
    AskAuthority,
    type AgentAskAnswerItem,
    AskCrystalCandidatePolicy,
    AskReason,
    AskResumePolicy,
    AskSource,
    ContinuationContextReason,
    ModelRole,
    type AgentAsk,
    type ModelClient,
    type ModelMessage,
} from "../../../protocol/contracts/index.ts";
import type {
    ExecutiveLoopGuardOptions,
    ExecutiveToolRuntimeAskRequired,
    ExecutiveToolRuntimeBudget,
} from "../../../executive/index.ts";
import {
    type McpToolCallExecution,
    type McpToolCallRequest,
    type McpToolCatalogEntry,
} from "../../mcp/index.ts";
import {
    RuntimeMcpToolNeedDecisionKind,
    type RuntimeMcpToolNeedComponent,
    type WorkspaceToolset,
} from "../mcp/index.ts";

export interface CodingThinkingBudgetOptions {
    executiveToolBudget?: ExecutiveToolRuntimeBudget;
    maxToolTurns?: number;
}

export type CodingThinkingBudget = Required<Pick<ExecutiveToolRuntimeBudget, "modelToolTurnBudget">> &
    ExecutiveToolRuntimeBudget;

export interface CodingThinkingToolFailureCall {
    readonly error?: string;
    readonly ok: boolean;
    readonly server: string;
    readonly tool: string;
}

export interface CodingThinkingToolFailureContinuation {
    readonly sourceKey: string;
    readonly ownerKey?: string;
    readonly reason: typeof ContinuationContextReason.ToolFailure;
    readonly userFacing: { title: string; contextHint?: string };
    readonly snapshot: {
        originalUserMessage: string;
        mcpCallProgress: Array<{ tool: string; status: string; lastError?: string }>;
    };
    readonly sourceSurface?: string;
    readonly requestId?: string;
    readonly importance: number;
}

export interface CodingThinkingAskExecutionStrategy {
    readonly mode?: "continue" | "narrow" | "stop";
    readonly budget?: "increase-one-tier" | "keep" | "user-defined";
    readonly subagents?: "keep" | "reduce" | "disable";
}

export const CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET = 192;
export const CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN =
    /((?:\/[^\s"'()[\]{}<>，。；：！？、]+)+|[A-Za-z]:\\[^\s"'()[\]{}<>，。；：！？、]+)/gu;

/**
 * Coding thinking owns tool-loop execution shape.
 *
 * Runtime still assembles memory, route, sandbox and catalogs; this policy keeps
 * coding/exploration budgets and loop-guard math out of the turn orchestrator.
 */
export class CodingThinkingPolicy {
    public budgetFor(options: CodingThinkingBudgetOptions): CodingThinkingBudget {
        const configured = options.executiveToolBudget;
        return {
            executionOperationBudget: configured?.executionOperationBudget,
            modelToolTurnBudget: Math.max(
                1,
                configured?.modelToolTurnBudget ??
                    options.maxToolTurns ??
                    CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET,
            ),
            riskQuota: configured?.riskQuota,
        };
    }

    public loopGuardForBudget(budget: CodingThinkingBudget): ExecutiveLoopGuardOptions {
        return {
            maxCalls: Math.max(16, budget.modelToolTurnBudget * 4),
            maxFailedCallRepeats: 2,
            maxRepeatedCalls: Math.max(3, Math.ceil(budget.modelToolTurnBudget / 8)),
            maxUnknownToolRepeats: 1,
        };
    }

    public readAskExecutionStrategy(
        metadata: Record<string, unknown> | undefined,
    ): CodingThinkingAskExecutionStrategy | undefined {
        const raw = this.readCitizenPermissionAnswerMetadata(metadata);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
        const payload = raw as Record<string, unknown>;
        const answers = Array.isArray(payload.answers) ? payload.answers : [payload];
        let strategy: CodingThinkingAskExecutionStrategy = {};
        for (const answer of answers) {
            if (!answer || typeof answer !== "object" || Array.isArray(answer)) continue;
            strategy = this.mergeAskExecutionStrategy(
                strategy,
                this.askExecutionStrategyFromAnswer(answer as AgentAskAnswerItem & { executionPatch?: unknown }),
            );
        }
        return Object.keys(strategy).length > 0 ? strategy : undefined;
    }

    public hasExecutableCitizenPermissionAnswer(metadata: Record<string, unknown> | undefined): boolean {
        const raw = this.readCitizenPermissionAnswerMetadata(metadata);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        const payload = raw as Record<string, unknown>;
        if (Array.isArray(payload.answers)) {
            return payload.answers.some((answer) => this.isExecutableCitizenPermissionAnswerItem(answer));
        }
        return this.isExecutableCitizenPermissionAnswerItem(payload);
    }

    public applyAskExecutionStrategy<TOptions extends CodingThinkingBudgetOptions>(
        options: TOptions,
        strategy?: CodingThinkingAskExecutionStrategy,
    ): TOptions {
        if (!strategy || strategy.budget !== "increase-one-tier") return options;
        const currentBudget = this.budgetFor(options);
        const modelToolTurnBudget = Math.max(
            currentBudget.modelToolTurnBudget + 32,
            Math.ceil(currentBudget.modelToolTurnBudget * 2),
        );
        return {
            ...options,
            executiveToolBudget: {
                ...options.executiveToolBudget,
                executionOperationBudget:
                    options.executiveToolBudget?.executionOperationBudget === undefined
                        ? undefined
                        : Math.max(
                              options.executiveToolBudget.executionOperationBudget + 32,
                              Math.ceil(options.executiveToolBudget.executionOperationBudget * 2),
                          ),
                modelToolTurnBudget,
                riskQuota: options.executiveToolBudget?.riskQuota,
            },
            maxToolTurns: Math.max(options.maxToolTurns ?? 0, modelToolTurnBudget),
        };
    }

    public hasLocalAbsolutePath(text: string): boolean {
        CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        const matched = CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.test(text);
        CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        return matched;
    }

    public async decideInitialToolNeed(input: {
        assistantDraft: string;
        catalog: readonly McpToolCatalogEntry[];
        messages: readonly ModelMessage[];
        model: ModelClient;
        onModelAllocation?: () => void;
        signal?: AbortSignal;
        toolNeed: RuntimeMcpToolNeedComponent;
    }): Promise<string | undefined> {
        const userMessage = this.latestUserMessage(input.messages);
        if (!userMessage) return undefined;
        try {
            input.onModelAllocation?.();
            const decision = await input.toolNeed.decide({
                assistantDraft: input.assistantDraft,
                catalog: input.catalog,
                model: input.model,
                signal: input.signal,
                userRequest: userMessage.content,
            });
            if (decision.decision !== RuntimeMcpToolNeedDecisionKind.UseTools || decision.calls.length === 0) {
                return undefined;
            }
            return this.renderToolCalls(decision.calls);
        } catch {
            return undefined;
        }
    }

    public async initialLocalPathProbe(input: {
        catalog: readonly McpToolCatalogEntry[];
        messages: readonly ModelMessage[];
        workspaceToolset: WorkspaceToolset;
    }): Promise<string | undefined> {
        const userMessage = this.latestUserMessage(input.messages);
        if (!userMessage) return undefined;
        const path = await this.firstExistingAbsolutePath(userMessage.content);
        if (!path) return undefined;
        const tool = await this.workspaceProbeTool(path, input.workspaceToolset);
        if (!tool) return undefined;
        const key = `workspace.${tool}`;
        if (!input.catalog.some((entry) => `${entry.server}.${entry.tool.name}` === key)) return undefined;
        return this.renderToolCalls([
            {
                server: "workspace",
                tool,
                input: tool === "tree" ? { path, maxDepth: 3, maxEntries: 200 } : { path },
            },
        ]);
    }

    public buildToolFailureContinuation(input: {
        mcpCalls: readonly CodingThinkingToolFailureCall[];
        originalUserMessage: string;
        ownerKey?: string;
        requestId?: string;
        sourceKey: string;
        sourceSurface?: string;
    }): CodingThinkingToolFailureContinuation | undefined {
        const failures = input.mcpCalls.filter((call) => !call.ok);
        if (failures.length === 0) return undefined;
        const head = failures[0]!;
        const title = `MCP tool failed: ${head.server}/${head.tool}`;
        const contextHint = head.error
            ? head.error.slice(0, 200)
            : failures.length > 1
              ? `${failures.length - 1} more failure(s) in this turn`
              : undefined;
        const mcpCallProgress = failures.slice(0, 8).map((call) => ({
            tool: `${call.server}/${call.tool}`,
            status: "error",
            lastError: call.error ? call.error.slice(0, 200) : undefined,
        }));
        return {
            ownerKey: input.ownerKey,
            sourceKey: input.sourceKey,
            reason: ContinuationContextReason.ToolFailure,
            userFacing: contextHint ? { title, contextHint } : { title },
            snapshot: {
                originalUserMessage: input.originalUserMessage.slice(0, 500),
                mcpCallProgress,
            },
            sourceSurface: input.sourceSurface,
            requestId: input.requestId,
            importance: 0.6,
        };
    }

    public buildExecutiveToolAsk(input: {
        askRequired: ExecutiveToolRuntimeAskRequired;
        executions: readonly McpToolCallExecution[];
    }): AgentAsk {
        const { askRequired, executions } = input;
        const failed = executions.filter((execution) => !execution.ok);
        const failureSummary = failed.slice(0, 3).map((execution) => `${execution.call.server}.${execution.call.tool}`);
        const progressSummary = this.renderExecutiveToolProgressSummary(executions);
        const basePrompt =
            askRequired.toolBudgetExhausted === true
                ? "本轮工具调用预算已用完。要继续执行当前任务，还是先调整目标范围？"
                : "执行层连续遇到工具阻断。请补充下一步执行策略或调整约束后再继续。";
        const prompt = progressSummary ? `${basePrompt}\n\n已记录的工具进度：${progressSummary}` : basePrompt;
        return {
            authority: AskAuthority.Executive,
            answerContract: {
                kind: AskAnswerContractKind.CitizenPermission,
                acceptedMetadataKeys: ["confirmAnswer"],
                metadataKey: "confirmAnswer",
                requiresStructuredAnswer: true,
            },
            reason: AskReason.PolicyDecision,
            resumePolicy: askRequired.toolBudgetExhausted === true ? AskResumePolicy.Continue : AskResumePolicy.Replan,
            source: askRequired.toolStability ? AskSource.ToolStability : AskSource.Executive,
            prompt,
            questions: [
                {
                    id: "execution-strategy",
                    prompt: "下一步执行策略是什么？",
                    choices: [
                        {
                            id: "continue-tools",
                            label: "继续执行",
                            value: "continue-tools",
                            description: "允许下一轮继续使用工具完成当前任务。",
                            recommended: true,
                            executionPatch: { mode: "continue" },
                        },
                        {
                            id: "narrow-scope",
                            label: "缩小范围",
                            value: "narrow-scope",
                            description: "减少本轮目标，只处理最关键部分。",
                            executionPatch: { mode: "narrow" },
                        },
                        {
                            id: "stop-and-crystalize",
                            label: "停止并结晶",
                            value: "stop-and-crystalize",
                            description: "停止当前执行循环，并把已得到的执行经验作为候选沉淀。",
                            executionPatch: { mode: "stop" },
                        },
                    ],
                    recommendedChoiceId: "continue-tools",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    crystalCandidatePolicy: AskCrystalCandidatePolicy.Candidate,
                    rationale: "executive-loop-strategy",
                },
                {
                    id: "budget-policy",
                    prompt: "是否调整下一轮工具预算？",
                    choices: [
                        {
                            id: "increase-budget",
                            label: "增加一档预算",
                            value: "increase-budget",
                            description: "适合任务仍然明确、只是当前额度不足的情况。",
                            recommended: askRequired.toolBudgetExhausted === true,
                            executionPatch: { budget: "increase-one-tier" },
                        },
                        {
                            id: "keep-budget",
                            label: "保持预算",
                            value: "keep-budget",
                            description: "适合先让模型重新规划，不扩大执行面。",
                            recommended: askRequired.toolBudgetExhausted !== true,
                            executionPatch: { budget: "keep" },
                        },
                        {
                            id: "user-budget",
                            label: "自定义预算",
                            value: "user-budget",
                            description: "你可以在其他输入里指定更具体的工具轮数或限制。",
                            executionPatch: { budget: "user-defined" },
                        },
                    ],
                    recommendedChoiceId: askRequired.toolBudgetExhausted === true ? "increase-budget" : "keep-budget",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    rationale: "executive-loop-budget",
                },
                {
                    id: "subagent-policy",
                    prompt: "是否调整子代理执行方式？",
                    choices: [
                        {
                            id: "keep-subagents",
                            label: "按当前拆分继续",
                            value: "keep-subagents",
                            description: "保留已规划的子任务和工具隔离策略。",
                            recommended: true,
                            executionPatch: { subagents: "keep" },
                        },
                        {
                            id: "reduce-subagents",
                            label: "减少子代理",
                            value: "reduce-subagents",
                            description: "降低并发和上下文分叉，适合需要更稳的串行推进。",
                            executionPatch: { subagents: "reduce" },
                        },
                        {
                            id: "no-subagents",
                            label: "不使用子代理",
                            value: "no-subagents",
                            description: "回到单执行循环，适合任务范围较小或需要强一致判断。",
                            executionPatch: { subagents: "disable" },
                        },
                    ],
                    recommendedChoiceId: "keep-subagents",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    rationale: "executive-loop-subagent-policy",
                },
            ],
            choices: [
                {
                    id: "continue-tools",
                    label: "继续执行",
                    value: "continue-tools",
                    description: "允许下一轮继续使用工具完成当前任务。",
                },
                {
                    id: "narrow-scope",
                    label: "缩小范围",
                    value: "narrow-scope",
                    description: "减少本轮目标，只处理最关键部分。",
                },
                {
                    id: "stop-and-crystalize",
                    label: "停止并结晶",
                    value: "stop-and-crystalize",
                    description: "停止当前执行循环，并把已得到的执行经验作为候选沉淀。",
                },
            ],
            freeform: true,
            relatedIds: failureSummary,
            ...(askRequired.job || askRequired.toolStability
                ? {
                      crystalCandidates: [
                          ...(askRequired.job
                              ? [
                                    {
                                        kind: "execution-job",
                                        jobId: askRequired.jobId,
                                        progress: askRequired.job.progress,
                                        status: askRequired.job.status,
                                    },
                                ]
                              : []),
                          ...(askRequired.toolStability
                              ? [
                                    {
                                        kind: "tool-stability",
                                        stability: askRequired.toolStability,
                                    },
                                ]
                              : []),
                      ],
                  }
                : {}),
            rationale:
                askRequired.toolBudgetExhausted === true
                    ? "executive-tool-loop:budget"
                    : `executive-tool-loop:guard:${askRequired.loopGuardReason ?? "blocked"}`,
            continuationHint: {
                title: askRequired.toolBudgetExhausted === true ? "Tool budget exhausted" : "Tool loop blocked",
                contextHint: progressSummary
                    ? `${askRequired.message.slice(0, 160)} | ${progressSummary}`
                    : askRequired.message.slice(0, 200),
            },
        };
    }

    private readCitizenPermissionAnswerMetadata(metadata: Record<string, unknown> | undefined): unknown {
        return metadata?.confirmAnswer;
    }

    private isExecutableCitizenPermissionAnswerItem(answer: unknown): boolean {
        if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
        const strategy = this.askExecutionStrategyFromAnswer(
            answer as AgentAskAnswerItem & { executionPatch?: unknown },
        );
        return Object.keys(strategy).length > 0;
    }

    private askExecutionStrategyFromAnswer(
        answer: AgentAskAnswerItem & { executionPatch?: unknown },
    ): CodingThinkingAskExecutionStrategy {
        const fromPatch = this.askExecutionStrategyFromPatch(answer.executionPatch);
        const tokens = [answer.choiceId, typeof answer.value === "string" ? answer.value : undefined].filter(
            (token): token is string => Boolean(token),
        );
        return tokens.reduce(
            (strategy, token) => this.mergeAskExecutionStrategy(strategy, this.askExecutionStrategyFromToken(token)),
            fromPatch,
        );
    }

    private askExecutionStrategyFromPatch(value: unknown): CodingThinkingAskExecutionStrategy {
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        const record = value as Record<string, unknown>;
        return {
            ...(record.mode === "continue" || record.mode === "narrow" || record.mode === "stop"
                ? { mode: record.mode }
                : {}),
            ...(record.budget === "increase-one-tier" || record.budget === "keep" || record.budget === "user-defined"
                ? { budget: record.budget }
                : {}),
            ...(record.subagents === "keep" || record.subagents === "reduce" || record.subagents === "disable"
                ? { subagents: record.subagents }
                : {}),
        };
    }

    private askExecutionStrategyFromToken(token: string): CodingThinkingAskExecutionStrategy {
        switch (token) {
            case "continue-tools":
                return { mode: "continue" };
            case "narrow-scope":
                return { mode: "narrow" };
            case "stop-and-crystallize":
            case "stop-and-crystalize":
                return { mode: "stop" };
            case "increase-budget":
                return { budget: "increase-one-tier" };
            case "keep-budget":
                return { budget: "keep" };
            case "user-budget":
                return { budget: "user-defined" };
            case "keep-subagents":
                return { subagents: "keep" };
            case "reduce-subagents":
                return { subagents: "reduce" };
            case "no-subagents":
                return { subagents: "disable" };
            default:
                return {};
        }
    }

    private mergeAskExecutionStrategy(
        left: CodingThinkingAskExecutionStrategy,
        right: CodingThinkingAskExecutionStrategy,
    ): CodingThinkingAskExecutionStrategy {
        const mode = right.mode ?? left.mode;
        const budget = right.budget ?? left.budget;
        const subagents = right.subagents ?? left.subagents;
        return {
            ...(mode ? { mode } : {}),
            ...(budget ? { budget } : {}),
            ...(subagents ? { subagents } : {}),
        };
    }

    private latestUserMessage(messages: readonly ModelMessage[]): ModelMessage | undefined {
        return [...messages].reverse().find((message) => message.role === ModelRole.User);
    }

    private renderToolCalls(calls: readonly McpToolCallRequest[]): string {
        return `<agent_tool_calls>${JSON.stringify({ calls })}</agent_tool_calls>`;
    }

    private async firstExistingAbsolutePath(text: string): Promise<string | undefined> {
        CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        for (const match of text.matchAll(CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN)) {
            const path = await this.existingAbsolutePathPrefix(match[1]?.trim() ?? "");
            if (path) {
                CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
                return path;
            }
        }
        CODING_THINKING_LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        return undefined;
    }

    private async existingAbsolutePathPrefix(raw: string): Promise<string | undefined> {
        if (!raw) return undefined;
        if (await this.localPathExists(raw)) return raw;
        for (let index = raw.length - 1; index > 0; index -= 1) {
            const candidate = raw.slice(0, index);
            const suffix = raw.slice(index);
            if (suffix.includes("/") || suffix.includes("\\")) continue;
            if (candidate === "/" || /^[A-Za-z]:\\?$/u.test(candidate)) continue;
            if (await this.localPathExists(candidate)) return candidate;
        }
        return undefined;
    }

    private async localPathExists(path: string): Promise<boolean> {
        try {
            await stat(path);
            return true;
        } catch {
            return false;
        }
    }

    private async workspaceProbeTool(path: string, workspaceToolset: WorkspaceToolset): Promise<string | undefined> {
        try {
            const result = await workspaceToolset.executeWithAccess(
                { server: "workspace", tool: "stat", input: { path } },
                { approved: true, reason: "thinking-local-path-probe" },
            );
            if (result.isError || !result.raw || typeof result.raw !== "object") return undefined;
            const type = (result.raw as { type?: unknown }).type;
            return type === "directory" ? "tree" : type === "file" ? "read" : undefined;
        } catch {
            return undefined;
        }
    }

    private renderExecutiveToolProgressSummary(executions: readonly McpToolCallExecution[]): string | undefined {
        if (executions.length === 0) return undefined;
        const entries = executions.slice(0, 6).map((execution) => {
            const status = execution.ok ? "ok" : "blocked";
            const key = `${execution.call.server}.${execution.call.tool}`;
            return `${key}:${status}`;
        });
        if (executions.length > entries.length) {
            entries.push(`more:${executions.length - entries.length}`);
        }
        return entries.join(", ");
    }
}

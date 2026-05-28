import { stat } from "node:fs/promises";

import { ModelRole, type ModelClient, type ModelMessage } from "../../../protocol/contracts/index.ts";
import type {
    ExecutiveLoopGuardOptions,
    ExecutiveToolRuntimeBudget,
} from "../../../executive/index.ts";
import {
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
}

import type {
    ExecutiveLoopGuardOptions,
    ExecutiveToolRuntimeBudget,
} from "../../../executive/index.ts";

export interface CodingThinkingBudgetOptions {
    executiveToolBudget?: ExecutiveToolRuntimeBudget;
    maxToolTurns?: number;
}

export type CodingThinkingBudget = Required<Pick<ExecutiveToolRuntimeBudget, "modelToolTurnBudget">> &
    ExecutiveToolRuntimeBudget;

export const CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET = 192;

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
}

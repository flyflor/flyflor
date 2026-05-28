import { describe, expect, test } from "bun:test";
import {
    CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET,
    CodingThinkingPolicy,
} from "../src/agent/runtime/thinking/index.ts";

describe("CodingThinkingPolicy", () => {
    test("owns the default coding tool-loop budget outside RuntimeModule", () => {
        const policy = new CodingThinkingPolicy();

        expect(policy.budgetFor({})).toEqual({
            executionOperationBudget: undefined,
            modelToolTurnBudget: CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET,
            riskQuota: undefined,
        });
    });

    test("keeps explicit executive budgets stronger than legacy maxToolTurns", () => {
        const policy = new CodingThinkingPolicy();

        expect(
            policy.budgetFor({
                executiveToolBudget: {
                    executionOperationBudget: 11,
                    modelToolTurnBudget: 7,
                    riskQuota: 3,
                },
                maxToolTurns: 99,
            }),
        ).toEqual({
            executionOperationBudget: 11,
            modelToolTurnBudget: 7,
            riskQuota: 3,
        });
    });

    test("derives loop guards from the selected coding budget", () => {
        const policy = new CodingThinkingPolicy();

        expect(policy.loopGuardForBudget(policy.budgetFor({ maxToolTurns: 24 }))).toEqual({
            maxCalls: 96,
            maxFailedCallRepeats: 2,
            maxRepeatedCalls: 3,
            maxUnknownToolRepeats: 1,
        });
    });
});

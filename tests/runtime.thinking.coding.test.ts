import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    CODING_THINKING_COMPLETION_EXECUTION_OPERATION_BUDGET,
    CODING_THINKING_COMPLETION_MODEL_TOOL_TURN_BUDGET,
    CODING_THINKING_CONTINUATION_EXECUTION_OPERATION_BUDGET,
    CODING_THINKING_CONTINUATION_MODEL_TOOL_TURN_BUDGET,
    CODING_THINKING_DEFAULT_MODEL_TOOL_TURN_BUDGET,
    CodingThinkingPolicy,
} from "../src/agent/runtime/thinking/index.ts";
import { ExecutiveLoopGuardReason, ModelRole } from "../src/protocol/contracts/index.ts";
import { RuntimeMcpToolNeedDecisionKind } from "../src/agent/runtime/mcp/index.ts";

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

    test("owns local path detection for completion budget profiles", () => {
        const policy = new CodingThinkingPolicy();

        expect(policy.hasLocalAbsolutePath("please inspect /Users/example/project")).toBe(true);
        expect(policy.hasLocalAbsolutePath("please answer without local files")).toBe(false);
    });

    test("applies completion budget profile for local absolute-path work", () => {
        const policy = new CodingThinkingPolicy();

        expect(
            policy.applyCompletionBudgetProfile(
                { executiveToolBudget: { executionOperationBudget: 7, riskQuota: 2 } },
                { isContinuation: false, userText: "inspect /Users/example/project" },
            ),
        ).toEqual({
            executiveToolBudget: {
                executionOperationBudget: CODING_THINKING_COMPLETION_EXECUTION_OPERATION_BUDGET,
                modelToolTurnBudget: CODING_THINKING_COMPLETION_MODEL_TOOL_TURN_BUDGET,
                riskQuota: 2,
            },
            maxToolTurns: CODING_THINKING_COMPLETION_MODEL_TOOL_TURN_BUDGET,
        });
    });

    test("applies continuation budget profile without requiring a local path", () => {
        const policy = new CodingThinkingPolicy();

        expect(
            policy.applyCompletionBudgetProfile(
                { executiveToolBudget: { executionOperationBudget: 8 } },
                { isContinuation: true, userText: "continue" },
            ),
        ).toEqual({
            executiveToolBudget: {
                executionOperationBudget: CODING_THINKING_CONTINUATION_EXECUTION_OPERATION_BUDGET,
                modelToolTurnBudget: CODING_THINKING_CONTINUATION_MODEL_TOOL_TURN_BUDGET,
                riskQuota: undefined,
            },
            maxToolTurns: CODING_THINKING_CONTINUATION_MODEL_TOOL_TURN_BUDGET,
        });
    });

    test("does not override explicit completion budgets", () => {
        const policy = new CodingThinkingPolicy();
        const explicit = {
            executiveToolBudget: {
                executionOperationBudget: 33,
                modelToolTurnBudget: 22,
                riskQuota: 1,
            },
            maxToolTurns: 22,
        };

        expect(
            policy.applyCompletionBudgetProfile(explicit, {
                isContinuation: true,
                userText: "inspect /Users/example/project",
            }),
        ).toBe(explicit);
    });

    test("probes an existing local file with workspace.read before first model turn", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-thinking-"));
        try {
            const file = join(dir, "README.md");
            await writeFile(file, "hello", "utf8");
            const policy = new CodingThinkingPolicy();
            const raw = await policy.initialLocalPathProbe({
                catalog: [{ server: "workspace", tool: { name: "read", inputSchema: {} } }],
                messages: [{ role: ModelRole.User, content: `read ${file}` }],
                workspaceToolset: {
                    executeWithAccess: async () => ({ raw: { type: "file" } }),
                } as never,
            });

            expect(raw).toBe(
                `<agent_tool_calls>${JSON.stringify({
                    calls: [{ server: "workspace", tool: "read", input: { path: file } }],
                })}</agent_tool_calls>`,
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("wraps model-decided initial tool need inside thinking policy", async () => {
        const policy = new CodingThinkingPolicy();
        let allocated = false;
        const raw = await policy.decideInitialToolNeed({
            assistantDraft: "I can answer, but tools would help.",
            catalog: [{ server: "workspace", tool: { name: "tree", inputSchema: {} } }],
            messages: [{ role: ModelRole.User, content: "inspect this project" }],
            model: { generate: async () => "" } as never,
            onModelAllocation: () => {
                allocated = true;
            },
            toolNeed: {
                decide: async () => ({
                    calls: [{ server: "workspace", tool: "tree", input: { path: "." } }],
                    decision: RuntimeMcpToolNeedDecisionKind.UseTools,
                    raw: "{}",
                    reason: "needs-project-map",
                }),
            } as never,
        });

        expect(allocated).toBe(true);
        expect(raw).toBe(
            `<agent_tool_calls>${JSON.stringify({
                calls: [{ server: "workspace", tool: "tree", input: { path: "." } }],
            })}</agent_tool_calls>`,
        );
    });

    test("builds bounded tool-failure continuation evidence outside RuntimeModule", () => {
        const policy = new CodingThinkingPolicy();
        const continuation = policy.buildToolFailureContinuation({
            mcpCalls: [
                { ok: true, server: "workspace", tool: "read" },
                { ok: false, server: "git", tool: "diff", error: "x".repeat(260) },
                { ok: false, server: "process", tool: "run" },
            ],
            originalUserMessage: "inspect and fix".repeat(80),
            ownerKey: "owner-1",
            requestId: "req-1",
            sourceKey: "source-1",
            sourceSurface: "tui",
        });

        expect(continuation).toEqual({
            ownerKey: "owner-1",
            sourceKey: "source-1",
            reason: "tool-failure",
            userFacing: {
                title: "MCP tool failed: git/diff",
                contextHint: "x".repeat(200),
            },
            snapshot: {
                originalUserMessage: "inspect and fix".repeat(80).slice(0, 500),
                mcpCallProgress: [
                    { tool: "git/diff", status: "error", lastError: "x".repeat(200) },
                    { tool: "process/run", status: "error", lastError: undefined },
                ],
            },
            sourceSurface: "tui",
            requestId: "req-1",
            importance: 0.6,
        });
    });

    test("owns executive tool-loop ASK construction outside RuntimeModule", () => {
        const policy = new CodingThinkingPolicy();
        const ask = policy.buildExecutiveToolAsk({
            askRequired: {
                askId: "ask-1",
                crystalCandidate: {
                    kind: "executive-loop-pause",
                    reason: "failed-call-repeat",
                    summary: "tool loop blocked",
                },
                message: "tool loop exceeded retry guard after repeated failures",
                loopGuardReason: ExecutiveLoopGuardReason.FailedCallRepeat,
                pause: {
                    mode: "pause",
                    options: [{ mode: "continue" }, { mode: "narrow" }, { mode: "stop" }],
                },
                resume: { mode: "continue" },
                stepCount: 2,
                stop: "ask",
            },
            executions: [
                { ok: true, call: { server: "workspace", tool: "read" } },
                { ok: false, call: { server: "process", tool: "run" } },
            ] as never,
        });

        expect(ask.answerContract).toEqual({
            kind: "citizen-permission",
            acceptedMetadataKeys: ["confirmAnswer"],
            metadataKey: "confirmAnswer",
            requiresStructuredAnswer: true,
        });
        expect(ask.source).toBe("executive");
        expect(ask.resumePolicy).toBe("replan");
        expect(ask.relatedIds).toEqual(["process.run"]);
        expect(ask.continuationHint?.contextHint).toContain("workspace.read:ok, process.run:blocked");
        expect(ask.questions?.map((question) => question.id)).toEqual([
            "execution-strategy",
            "budget-policy",
            "subagent-policy",
        ]);
    });

    test("owns structured Confirm execution strategy parsing and budget expansion", () => {
        const policy = new CodingThinkingPolicy();
        const metadata = {
            confirmAnswer: {
                answers: [
                    { choiceId: "continue-tools", executionPatch: { budget: "increase-one-tier" } },
                    { value: "reduce-subagents" },
                ],
            },
        };

        expect(policy.hasExecutableCitizenPermissionAnswer(metadata)).toBe(true);
        const strategy = policy.readAskExecutionStrategy(metadata);
        expect(strategy).toEqual({
            budget: "increase-one-tier",
            mode: "continue",
            subagents: "reduce",
        });
        expect(
            policy.applyAskExecutionStrategy(
                {
                    executiveToolBudget: {
                        executionOperationBudget: 11,
                        modelToolTurnBudget: 7,
                        riskQuota: 3,
                    },
                    maxToolTurns: 7,
                },
                strategy,
            ),
        ).toEqual({
            executiveToolBudget: {
                executionOperationBudget: 43,
                modelToolTurnBudget: 39,
                riskQuota: 3,
            },
            maxToolTurns: 39,
        });
    });
});

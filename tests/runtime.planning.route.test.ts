import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
    loadPromptTemplates,
    renderPlanningRoutePrompt,
} from "../src/agent/prompts/index.ts";
import { RuntimeModule } from "../src/agent/runtime/index.ts";
import { RuntimePlanningRouteComponent } from "../src/agent/runtime/planning/index.ts";
import {
    BlackboardMode,
    InteractionMode,
    PlanningRouteDecisionKind,
} from "../src/protocol/contracts/index.ts";

describe("Runtime planning route", () => {
    test("parses plan, ask and direct decisions from structured model JSON", () => {
        const route = new RuntimePlanningRouteComponent();

        expect(route.parse(JSON.stringify({
                decision: PlanningRouteDecisionKind.Plan,
                confidence: 0.91,
                reason: "需要先拆计划",
                planTitle: "实现计划",
                planSummary: "先确认再执行",
        }), InteractionMode.Act)).toMatchObject({
            decision: PlanningRouteDecisionKind.Plan,
            planTitle: "实现计划",
            planSummary: "先确认再执行",
        });
        expect(route.parse(JSON.stringify({
                decision: PlanningRouteDecisionKind.Ask,
                confidence: 0.8,
                reason: "缺少目标范围",
                askPrompt: "请补充目标范围。",
        }), InteractionMode.Plan)).toMatchObject({
            decision: PlanningRouteDecisionKind.Ask,
            askPrompt: "请补充目标范围。",
        });
        expect(route.parse(JSON.stringify({
                decision: PlanningRouteDecisionKind.Direct,
                confidence: 0.7,
                reason: "简单请求",
        }), InteractionMode.Act)).toMatchObject({ decision: PlanningRouteDecisionKind.Direct });
    });

    test("forces plan mode direct decisions back to a plan draft", () => {
        const route = new RuntimePlanningRouteComponent();

        expect(route.parse(JSON.stringify({
            decision: PlanningRouteDecisionKind.Direct,
            confidence: 0.6,
            reason: "用户显式进入计划模式",
        }), InteractionMode.Plan)).toMatchObject({
            decision: PlanningRouteDecisionKind.Plan,
            reason: "用户显式进入计划模式",
        });
    });

    test("keeps blackboard route ahead of automatic planning in act mode", async () => {
        await expect(invokeResolvePlanningGate(InteractionMode.Act, BlackboardMode.Blackboard))
            .resolves.toMatchObject({ calls: 0, result: undefined });
        await expect(invokeResolvePlanningGate(InteractionMode.Act, BlackboardMode.DirectWithWatch))
            .resolves.toMatchObject({ calls: 0, result: undefined });
        await expect(invokeResolvePlanningGate(InteractionMode.Plan, BlackboardMode.Blackboard))
            .resolves.toMatchObject({
                calls: 1,
                result: {
                    decision: PlanningRouteDecisionKind.Plan,
                    planTitle: "Plan",
                    planSummary: "Summary",
                },
            });
    });

    test("planning prompt states blackboard, plan, ask and direct boundaries", async () => {
        await loadPromptTemplates({
            promptDir: join(import.meta.dir, "..", "templates", "prompts"),
        } as never, { force: true });

        const prompt = renderPlanningRoutePrompt({
            interactionMode: InteractionMode.Act,
            request: "我需要一个执行前确认的改造计划",
        });

        expect(prompt).toContain("Planning route boundary rubric");
        expect(prompt).toContain("Blackboard-owned conflicts");
        expect(prompt).toContain("Plan-owned work");
        expect(prompt).toContain("Ask-owned blockers");
        expect(prompt).toContain("Direct-owned requests");
        expect(prompt).toContain("strict square-circle area formula");
        expect(prompt).toContain("normal circle area formula");
    });
});

async function invokeResolvePlanningGate(
    interactionMode: InteractionMode,
    blackboardMode: BlackboardMode,
): Promise<{ calls: number; result: unknown }> {
    let calls = 0;
    const runtime = Object.create(RuntimeModule.prototype) as any;
    runtime.model = { generate: async () => "" };
    runtime.planningRoute = {
        decide: async () => {
            calls += 1;
            return {
                confidence: 0.9,
                decision: PlanningRouteDecisionKind.Plan,
                reason: "needs plan",
                raw: "{}",
                planTitle: "Plan",
                planSummary: "Summary",
            };
        },
    };

    const result = await (runtime as unknown as {
        resolvePlanningGate: (...args: unknown[]) => Promise<unknown>;
    }).resolvePlanningGate(
        { text: "x", metadata: {} },
        { interactionMode },
        { blackboardRun: blackboardMode ? { mode: blackboardMode } : undefined },
        {},
    );
    return { calls, result };
}

import {
    BlackboardWorkerRole,
    Worker,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
} from "../../fpc/index.ts";

@Worker({ name: BlackboardWorkerRole.Planner, tags: ["blackboard", "planner"] })
export class BlackboardPlannerWorker {
    run(input: BlackboardWorkerTask, _context: unknown): BlackboardWorkerResult {
        const previousFacts = input.previousSteps.flatMap((step) => step.newFacts);
        const previousBlockers = input.previousSteps.flatMap((step) => step.blockers);
        const isFirstRound = input.round <= 1;
        const outputSummary = [
            "拆解目标并锁定下一步执行路径。",
            `当前目标：${truncate(input.goal, 160)}`,
            previousFacts.length > 0 ? `已知事实：${previousFacts.slice(-3).join("；")}` : "暂无已知事实。",
            previousBlockers.length > 0
                ? `上一轮 blocker：${previousBlockers.slice(-3).join("；")}`
                : "上一轮没有 blocker。",
        ].join(" ");
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: isFirstRound
                ? `${outputSummary} 先提出待确认点，不急着定案。`
                : `${outputSummary} 根据上一轮反馈收敛到可执行路径。`,
            newFacts: isFirstRound ? ["Planner 已拆解出首轮方案草案。"] : ["Planner 已根据反馈压缩到可执行路径。"],
            blockers: isFirstRound ? ["需要 Reviewer 复核边界、验收标准和隐含假设。"] : [],
            risk: isFirstRound ? "medium" : "low",
            discussion: [
                {
                    role: "planner",
                    content: outputSummary,
                    visibility: "public",
                },
            ],
            metadata: {
                worker: BlackboardWorkerRole.Planner,
                strategy: "bounded-planning",
            },
        };
    }
}

@Worker({ name: BlackboardWorkerRole.Reviewer, tags: ["blackboard", "reviewer"] })
export class BlackboardReviewerWorker {
    run(input: BlackboardWorkerTask, _context: unknown): BlackboardWorkerResult {
        const blockers = input.previousSteps.flatMap((step) => step.blockers);
        const previousFacts = input.previousSteps.flatMap((step) => step.newFacts);
        const isFirstRound = input.round <= 1;
        const outputSummary = [
            "复核黑板状态、边界和可交付性。",
            previousFacts.length > 0 ? `上一轮事实：${previousFacts.slice(-3).join("；")}` : "上一轮没有可复用事实。",
            blockers.length > 0 ? `仍有 blocker：${blockers.slice(-3).join("；")}` : "当前没有未解除 blocker。",
            "确认 worker 不直接执行工具、不直接写长期记忆。",
        ].join(" ");
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: isFirstRound
                ? `${outputSummary} 先保留一个复核问题，避免过早收敛。`
                : `${outputSummary} 复核确认可以收敛。`,
            newFacts: isFirstRound ? ["Reviewer 已标出首轮复核关注点。"] : ["Reviewer 已确认首轮关注点已收敛。"],
            blockers: isFirstRound ? ["需要确认最终验收标准和风险边界。"] : [],
            risk: blockers.length > 0 || isFirstRound ? "medium" : "low",
            discussion: [
                {
                    role: "reviewer",
                    content: outputSummary,
                    visibility: "public",
                },
            ],
            metadata: {
                worker: BlackboardWorkerRole.Reviewer,
                strategy: "boundary-review",
            },
        };
    }
}

export function createBuiltinWorkers() {
    return [new BlackboardPlannerWorker(), new BlackboardReviewerWorker()];
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

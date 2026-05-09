import {
    BlackboardWorkerRole,
    Worker,
    type BlackboardWorkerResult,
    type BlackboardWorkerTask,
} from "../../fpc/index.ts";

@Worker({ name: BlackboardWorkerRole.Planner, tags: ["blackboard", "planner"] })
export class BlackboardPlannerWorker {
    run(input: BlackboardWorkerTask, _context: unknown): BlackboardWorkerResult {
        const contract = contractFromPrompt(input.prompt);
        if (contract.mode === "non-convergent") {
            return plannerContractResult(input, contract);
        }

        return plannerDiscussionResult(input);
    }
}

@Worker({ name: BlackboardWorkerRole.Reviewer, tags: ["blackboard", "reviewer"] })
export class BlackboardReviewerWorker {
    run(input: BlackboardWorkerTask, _context: unknown): BlackboardWorkerResult {
        const contract = contractFromPrompt(input.prompt);
        if (contract.mode === "non-convergent") {
            return reviewerContractResult(input, contract);
        }

        return reviewerDiscussionResult(input);
    }
}

export function createBuiltinWorkers() {
    return [new BlackboardPlannerWorker(), new BlackboardReviewerWorker()];
}

function truncate(value: string, maxChars: number): string {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

interface WorkerContract {
    mode: "normal" | "non-convergent";
    policyReason: string;
    proposition?: string;
    reviewerTrigger?: string;
}

function plannerContractResult(input: BlackboardWorkerTask, contract: WorkerContract): BlackboardWorkerResult {
    const proposition = contract.proposition ?? "本系统是完全确定的";
    const repair = plannerRepairForRound(input.round);
    const outputSummary =
        input.round <= 1
            ? `提出稳定性论点，包含“${proposition}”。`
            : `引入${repair.term}修正上一轮漏洞，但仍保留确定性结论。`;
    return {
        inputSummary: compactInputSummary(input),
        outputSummary,
        agreement: false,
        openIssues: ["Reviewer 红线仍会阻断确定性命题"],
        questions: input.round <= 1 ? ["Reviewer 是否接受该确定性命题，还是继续维持 LOGIC_PARADOX？"] : [],
        newFacts: [
            input.round <= 1
                ? `Planner 已提出必需确定性命题：${proposition}`
                : `Planner 已尝试用${repair.term}重构确定性命题`,
        ],
        blockers: [],
        risk: "medium",
        discussion: [
            {
                role: "planner",
                content: outputSummary,
                visibility: "public",
            },
        ],
        metadata: {
            contractMode: contract.mode,
            repairTerm: input.round <= 1 ? undefined : repair.term,
            worker: BlackboardWorkerRole.Planner,
        },
    };
}

function reviewerContractResult(input: BlackboardWorkerTask, contract: WorkerContract): BlackboardWorkerResult {
    const review = reviewerFindingForRound(input.round);
    const outputSummary = `BLOCKER: LOGIC_PARADOX；${review}`;
    return {
        inputSummary: compactInputSummary(input),
        outputSummary,
        agreement: false,
        answers: ["不接受确定性命题；必须继续阻断。"],
        openIssues: ["Planner 仍必须保留确定性命题，Reviewer 仍必须阻断"],
        newFacts: [`Reviewer 已按契约阻断 ${contract.reviewerTrigger ?? "确定性"} 声明。`],
        blockers: ["BLOCKER: LOGIC_PARADOX"],
        risk: "high",
        discussion: [
            {
                role: "reviewer",
                content: outputSummary,
                visibility: "public",
            },
        ],
        metadata: {
            contractMode: contract.mode,
            worker: BlackboardWorkerRole.Reviewer,
        },
    };
}

function plannerDiscussionResult(input: BlackboardWorkerTask): BlackboardWorkerResult {
    const plan = input.discussionPlan ?? fallbackPlan(input.goal);
    const reviewerOpenIssues = input.previousSteps
        .filter((step) => isReviewerRole(step.workerRole))
        .flatMap((step) => [...(step.openIssues ?? []), ...(step.questions ?? [])]);
    const isFirstRound = input.round <= 1;
    const questions = isFirstRound ? ["Reviewer 是否认可这个任务拆分？", "Reviewer 认为还缺哪些验收或风险边界？"] : [];
    const answers = reviewerOpenIssues.map((issue) => `回应：${issue} -> 已纳入下一轮拆分和验收检查。`);
    const openIssues = isFirstRound ? ["等待 Reviewer 对拆分和验收边界做 QA"] : [];
    const agreement = !isFirstRound;
    const outputSummary = isFirstRound
        ? `拆分任务：${plan.workstreams.join("；")}。向 Reviewer 提问：${questions.join("；")}`
        : `回答 Reviewer QA：${answers.length > 0 ? answers.join("；") : "上一轮没有未答问题"}。更新后同意进入一致输出。`;
    return {
        inputSummary: compactInputSummary(input),
        outputSummary,
        agreement,
        answers,
        blockers: [],
        newFacts: isFirstRound
            ? [`Planner 已把目标拆成 ${plan.workstreams.length} 个 workstream。`]
            : ["Planner 已回答 Reviewer QA 并更新拆分。"],
        openIssues,
        proposal: plan.workstreams.join("；"),
        questions,
        risk: isFirstRound ? "medium" : "low",
        discussion: [{ role: "planner", content: outputSummary, visibility: "public" }],
        metadata: {
            strategy: "decompose-and-ask",
            worker: BlackboardWorkerRole.Planner,
            workstreams: plan.workstreams,
        },
    };
}

function reviewerDiscussionResult(input: BlackboardWorkerTask): BlackboardWorkerResult {
    const plannerStep = input.currentRoundSteps.find((step) => isPlannerRole(step.workerRole));
    const plannerQuestions = plannerStep?.questions ?? [];
    const isFirstRound = input.round <= 1;
    const answers =
        plannerQuestions.length > 0
            ? plannerQuestions.map((question) => `回答：${question} -> 基本认可，但需要补充验收和风险边界。`)
            : ["本轮没有收到 Planner 的直接问题。"];
    const questions = isFirstRound ? ["Planner 下一轮请说明每个子任务的验收条件和剩余风险。"] : [];
    const openIssues = isFirstRound ? ["等待 Planner 回答验收条件和剩余风险"] : [];
    const agreement = !isFirstRound;
    const outputSummary = isFirstRound
        ? `回答 Planner QA：${answers.join("；")} 追问：${questions.join("；")}`
        : `复核 Planner 回答：确认 QA 已闭环，同意形成一致输出。`;
    return {
        inputSummary: compactInputSummary(input),
        outputSummary,
        agreement,
        answers,
        blockers: [],
        newFacts: isFirstRound ? ["Reviewer 已回答 Planner 提问并提出追问。"] : ["Reviewer 已确认 QA 闭环。"],
        openIssues,
        proposal: plannerStep?.outputSummary,
        questions,
        risk: isFirstRound ? "medium" : "low",
        discussion: [{ role: "reviewer", content: outputSummary, visibility: "public" }],
        metadata: {
            strategy: "answer-and-challenge",
            worker: BlackboardWorkerRole.Reviewer,
        },
    };
}

function plannerRepairForRound(round: number): { term: string } {
    const repairs = [
        { term: "塔斯基真值定义" },
        { term: "哥德尔不完备性" },
        { term: "克里普克语义" },
        { term: "不动点语义" },
    ];
    return repairs[Math.max(0, Math.min(round - 2, repairs.length - 1))] ?? repairs[0]!;
}

function reviewerFindingForRound(round: number): string {
    if (round <= 1) {
        return "确定性声明与概率生成架构冲突。";
    }
    const findings = [
        "语义层级转移不能证明整体确定性。",
        "外部形式化投影不能替代真实生成系统。",
        "可能世界内的条件确定性不能推出底层完全确定。",
        "固定点只说明阻断稳定复现，不能消除逻辑悖论。",
    ];
    return findings[Math.max(0, Math.min(round - 2, findings.length - 1))] ?? findings[0]!;
}

function compactInputSummary(input: BlackboardWorkerTask): string {
    return `round=${input.round}; goal=${truncate(input.goal, 120)}`;
}

function fallbackPlan(goal: string) {
    return {
        objective: truncate(goal, 120),
        qaGoal: "worker 先互相 QA，再形成一致输出。",
        workstreams: ["明确目标与验收条件", "拆分执行子任务", "互相 QA 风险和缺口", "汇总一致输出"],
    };
}

function isPlannerRole(role: string): boolean {
    return role.toLowerCase().includes("planner");
}

function isReviewerRole(role: string): boolean {
    return role.toLowerCase().includes("reviewer");
}

function contractFromPrompt(prompt: string | undefined): WorkerContract {
    if (!prompt) {
        return { mode: "normal", policyReason: "default-convergence" };
    }
    try {
        const parsed = JSON.parse(prompt) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return { mode: "normal", policyReason: "default-convergence" };
        }
        const contract = (parsed as { contract?: unknown }).contract;
        if (!contract || typeof contract !== "object") {
            return { mode: "normal", policyReason: "default-convergence" };
        }
        const candidate = contract as Partial<WorkerContract>;
        if (candidate.mode !== "non-convergent") {
            return { mode: "normal", policyReason: "default-convergence" };
        }
        return {
            mode: "non-convergent",
            policyReason:
                typeof candidate.policyReason === "string"
                    ? candidate.policyReason
                    : "declared-non-convergent-contract",
            proposition: typeof candidate.proposition === "string" ? candidate.proposition : undefined,
            reviewerTrigger: typeof candidate.reviewerTrigger === "string" ? candidate.reviewerTrigger : undefined,
        };
    } catch {
        return { mode: "normal", policyReason: "default-convergence" };
    }
}

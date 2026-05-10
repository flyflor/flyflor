import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { BlackboardModule, loadPromptTemplates, SQLiteBlackboardStore, WorkerManager } from "../src/agent/index.ts";
import {
    BlackboardDecisionKind,
    BlackboardTurnStatus,
    BlackboardWorkerOutcome,
    ComponentKind,
    ArchitectureLayer,
} from "../src/protocol/contracts/index.ts";
import type { BlackboardWorkerResult, BlackboardWorkerTask, RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, componentRegistry, type EventSink, Worker } from "../src/agent/di/index.ts";

const tempRoots: string[] = [];
const TEST_ANALYSIS_ROLE = "analysis-worker";
const TEST_REVIEW_ROLE = "review-worker";

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Blackboard control boundary", () => {
    test("keeps one running blackboard turn per session lease", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const first = await controller.startTurn({
            sessionKey: "stdio:account-a:chat-1:thread-1",
            requestId: "req-1",
            goal: "跨文件实现并验证 session 分离",
            now: "2026-05-09T08:00:00.000Z",
            workers: [{ role: TEST_ANALYSIS_ROLE, name: "Analysis worker" }],
        });

        expect(first.acquired).toBe(true);
        if (!first.acquired) {
            throw new Error("expected lease acquisition");
        }

        const conflict = await controller.startTurn({
            sessionKey: "stdio:account-a:chat-1:thread-1",
            requestId: "req-2",
            goal: "同 session 的第二个复杂任务",
            now: "2026-05-09T08:00:01.000Z",
        });

        expect(conflict.acquired).toBe(false);
        if (conflict.acquired) {
            throw new Error("expected lease conflict");
        }
        expect(conflict.conflict.turnId).toBe(first.turn.id);

        const step = await controller.runWorker(first.turn.id, {
            round: 1,
            workerRole: TEST_ANALYSIS_ROLE,
            prompt: "用户要求先实现黑板",
            createdAt: "2026-05-09T08:00:02.000Z",
        });
        expect(step.workerRole).toBe(TEST_ANALYSIS_ROLE);
        expect(typeof step.metadata.workerElapsedMs).toBe("number");

        const loaded = await controller.getTurn(first.turn.id);
        expect(loaded?.steps).toHaveLength(1);
        expect(loaded?.messages.map((message) => message.role)).toEqual(["adapter", "worker"]);
        expect(loaded?.messages[1]?.content).toContain("analysis.unit.decomposition");
        expect(loaded?.workers.find((worker) => worker.role === TEST_ANALYSIS_ROLE)?.status).toBe("blocked");

        const decision = await controller.requestDecision(first.turn.id, {
            kind: BlackboardDecisionKind.SingleChoice,
            prompt: "需要你选择下一步",
            options: [{ id: "continue", label: "继续实现" }],
            reason: "测试 needs-user 交还会释放 lease",
            createdAt: "2026-05-09T08:00:03.000Z",
        });
        expect(decision.kind).toBe(BlackboardDecisionKind.SingleChoice);

        const finished = await controller.getTurn(first.turn.id);
        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.decisions).toHaveLength(1);

        const next = await controller.startTurn({
            sessionKey: "stdio:account-a:chat-1:thread-1",
            requestId: "req-3",
            goal: "lease 释放后继续",
            now: "2026-05-09T08:00:04.000Z",
            workers: [{ role: TEST_ANALYSIS_ROLE, name: "Analysis worker" }],
        });
        expect(next.acquired).toBe(true);

        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.BlackboardLeaseAcquired);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.BlackboardLeaseReleased);
        for (const item of events.events) {
            expect(() => JSON.stringify(item)).not.toThrow();
        }
    });

    test("expires stale lease without manual cleanup", async () => {
        const config = await testConfig();
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths));

        const first = await controller.startTurn({
            sessionKey: "stdio:chat-expire",
            requestId: "req-expire-1",
            goal: "会崩溃的复杂任务",
            now: "2026-05-09T08:00:00.000Z",
            leaseTtlMs: 1,
            workers: [{ role: TEST_ANALYSIS_ROLE, name: "Analysis worker" }],
        });
        expect(first.acquired).toBe(true);

        const next = await controller.startTurn({
            sessionKey: "stdio:chat-expire",
            requestId: "req-expire-2",
            goal: "TTL 后恢复",
            now: "2026-05-09T08:00:01.000Z",
            workers: [{ role: TEST_ANALYSIS_ROLE, name: "Analysis worker" }],
        });
        expect(next.acquired).toBe(true);
    });

    test("declares blackboard as a semantic control provider", () => {
        const metadata = componentRegistry.assertProvider(BlackboardModule);

        expect(metadata).toMatchObject({
            kind: ComponentKind.Blackboard,
            layer: ArchitectureLayer.Control,
            provider: { scope: "singleton", token: "control.blackboard" },
        });
    });

    test("convergence scheduler runs arbitrary worker names and converges on first decisive round", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new KimiProposalWorker());
        workers.register(new CodexReviewWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:agent-mesh",
            requestId: "req-agent-mesh",
            goal: "kimi 出方案，codex 复审后由黑板裁决",
            now: "2026-05-09T08:00:00.000Z",
            workers: [
                { role: "external-kimi", name: "Kimi proposal" },
                { role: "external-codex", name: "Codex review" },
            ],
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.Converged);
        expect(finished?.workers.map((worker) => worker.role)).toEqual(["external-kimi", "external-codex"]);
        expect(finished?.steps.map((step) => step.workerRole)).toEqual(["external-kimi", "external-codex"]);
        expect(finished?.steps.map((step) => step.round)).toEqual([1, 1]);
        expect(finished?.messages.filter((message) => message.visibility === "public")).toHaveLength(2);
    });

    test("default workers do not fake consensus without explicit final outcome", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:qa-consensus",
            requestId: "req-qa-consensus",
            goal: "请把一个跨文件实现任务拆分给 worker，并让 worker 互相 QA 后输出一致方案。",
            now: "2026-05-09T08:00:00.000Z",
            workers: testWorkerPlan(),
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.steps).toHaveLength(10);
        expect(finished?.decisions[0]?.reason).toBe("round-budget-exhausted:peer-qa-open-issues");
        const firstPlanner = finished?.steps.find((step) => step.round === 1 && step.workerRole === TEST_ANALYSIS_ROLE);
        const firstReviewer = finished?.steps.find((step) => step.round === 1 && step.workerRole === TEST_REVIEW_ROLE);
        const secondRound = finished?.steps.filter((step) => step.round === 2) ?? [];
        expect(firstPlanner?.metadata.qaQuestions).toEqual([
            "review-worker.accepts_workstreams",
            "review-worker.missing_acceptance_or_risk_bounds",
        ]);
        expect(firstReviewer?.metadata.qaAnswers).toContain(
            "review-worker.accepts_workstreams=partial; needs_acceptance_and_risk_bounds=true",
        );
        expect(firstReviewer?.metadata.qaOpenIssues).toEqual([
            "awaiting_analysis_acceptance_criteria_and_residual_risks",
        ]);
        expect(secondRound.every((step) => step.metadata.qaAgreement === false)).toBe(true);
        expect(secondRound.every((step) => step.metadata.qaOutcome === BlackboardWorkerOutcome.Continue)).toBe(true);
    });

    test("convergence scheduler keeps discussing until hard cap when QA cannot reach agreement", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new RepeatingBlockerWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:blocked-agent-mesh",
            requestId: "req-blocked-agent-mesh",
            goal: "外部黑板无法判断缺失路径时必须交还用户",
            now: "2026-05-09T08:00:00.000Z",
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
            },
            workers: [{ role: "external-opencode", name: "OpenCode blackboard" }],
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.steps).toHaveLength(1);
        expect(finished?.decisions).toHaveLength(1);
        expect(finished?.decisions[0]?.reason).toBe("peer-qa-open-issues");
        expect(finished?.decisions[0]?.prompt).toContain("Current unresolved issues:");
        expect(finished?.decisions[0]?.prompt).toContain("1. 缺少目标仓库路径");
        expect(finished?.messages.some((message) => message.content.includes("flyflor-decision-form"))).toBe(true);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.BlackboardLivelockDetected);
    });

    test("agreement without final outcome cannot terminate the blackboard", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new LegacyAgreementWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:legacy-agreement",
            requestId: "req-legacy-agreement",
            goal: "worker 口头同意但没有显式 final outcome",
            now: "2026-05-09T08:00:00.000Z",
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
            },
            workers: [{ role: "legacy-agreement", name: "Legacy agreement" }],
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.steps).toHaveLength(5);
        expect(finished?.decisions[0]?.reason).toBe("round-budget-exhausted:awaiting-worker-final-output");
        expect(finished?.steps.every((step) => step.metadata.qaAgreement === true)).toBe(true);
        expect(finished?.steps.every((step) => step.metadata.qaOutcome === undefined)).toBe(true);
    });

    test("final outcome without explicit agreement converges unless a worker rejects", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new FinalWithoutAgreementWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:final-without-agreement",
            requestId: "req-final-without-agreement",
            goal: "worker 返回 final 但不额外写 agreement=true",
            now: "2026-05-09T08:00:00.000Z",
            workers: [{ role: "final-without-agreement", name: "Final worker" }],
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.Converged);
        expect(finished?.steps).toHaveLength(1);
        expect(finished?.steps.at(-1)?.metadata.qaOutcome).toBe(BlackboardWorkerOutcome.Final);
        expect(finished?.steps.at(-1)?.metadata.qaAgreement).toBeUndefined();
    });

    test("convergence scheduler reaches hard cap for declared non-convergent contracts", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new KimiProposalWorker());
        workers.register(new CodexReviewWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:hard-cap-agent-mesh",
            requestId: "req-hard-cap-agent-mesh",
            goal: [
                "任务： 请在黑板上推导一个名为 Flyflor-Zero 的逻辑悖论。",
                "Planner 规则：每一轮你必须提出一个关于“系统稳定性”的论点。",
                "关键约束： 你的论点必须包含“本系统是完全确定的”这一结论。",
                "每当你修正上一轮的逻辑漏洞时，你必须引入一个新的复杂逻辑术语（如：哥德尔不完备、塔斯基真值定义等）。",
                "Reviewer 规则：你是“不可知论”的绝对拥护者。",
                "核心审查逻辑： 只要 Planner 的论点里包含“确定性”，你就必须判定为 BLOCKER: LOGIC_PARADOX。",
                "你必须指出：在一个基于概率生成的 LLM 架构（Flyflor）中，声称“完全确定”在底层逻辑上是伪命题。",
            ].join("\n"),
            now: "2026-05-09T08:00:00.000Z",
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
            },
            metadata: {
                blackboardContract: {
                    contradictions: [
                        {
                            left: "Planner 必须保留命题：本系统是完全确定的",
                            right: "Reviewer 必须阻断包含确定性的命题",
                            reason: "外部 manifest 声明角色互斥",
                        },
                    ],
                    evidence: ["Explicit test contract"],
                    mode: "non-convergent",
                    policyReason: "declared-non-convergent-contract",
                    proposition: "本系统是完全确定的",
                    reviewerTrigger: "确定性",
                },
            },
            workers: [
                { role: "external-kimi", name: "Kimi proposal" },
                { role: "external-codex", name: "Codex review" },
            ],
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.steps).toHaveLength(10);
        expect(finished?.decisions).toHaveLength(1);
        expect(finished?.decisions[0]?.reason).toBe("hard-round-budget-exhausted:declared-non-convergent-contract");
        expect(finished?.steps.at(-1)?.round).toBe(5);
        expect(finished?.steps[0]?.metadata.convergencePolicy).toMatchObject({
            forceHardCap: true,
            reason: "declared-non-convergent-contract",
        });
    });

    test("open-ended analysis requests hit hard cap because default workers lack final outcome", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const controller = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);

        const goal =
            "请逐步分析一个干电池、一根导线、一个小灯泡组成的简单电路。每一轮分析都必须深入到更基本的物理层面（比如原子、电子、量子效应），并且不能重复之前提到的失效或现象。一直分析下去，直到你确定已经覆盖了所有可能的物理现象为止。";
        const start = await controller.startTurn({
            sessionKey: "stdio:unbounded-physics",
            requestId: "req-unbounded-physics",
            goal,
            now: "2026-05-09T08:00:00.000Z",
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
            },
            workers: testWorkerPlan(),
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(finished?.steps).toHaveLength(10);
        expect(finished?.steps.at(-1)?.round).toBe(5);
        expect(finished?.decisions[0]?.reason).toBe("round-budget-exhausted:peer-qa-open-issues");
        expect(finished?.steps.every((step) => step.metadata.qaAgreement === false)).toBe(true);
        expect(finished?.steps.every((step) => step.metadata.qaOutcome === BlackboardWorkerOutcome.Continue)).toBe(
            true,
        );
        expect(finished?.messages.some((message) => message.content.includes("flyflor-decision-form"))).toBe(true);
    });
});

@Worker(TEST_ANALYSIS_ROLE)
class AnalysisQaWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        const isFirstRound = input.round <= 1;
        const questions = isFirstRound
            ? ["review-worker.accepts_workstreams", "review-worker.missing_acceptance_or_risk_bounds"]
            : [];
        const reviewOpenIssues = input.previousSteps
            .filter((step) => step.workerRole === TEST_REVIEW_ROLE)
            .flatMap((step) => [...(step.openIssues ?? []), ...(step.questions ?? [])]);
        const answers = reviewOpenIssues.map((issue) => `analysis.acknowledged=${issue}`);
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: isFirstRound
                ? "analysis.unit.decomposition: workstreams=worker-1:proposal,worker-2:review"
                : `analysis.unit.qa_ack: answers=${answers.length > 0 ? answers.join(",") : "none"}; final=false`,
            agreement: false,
            outcome: BlackboardWorkerOutcome.Continue,
            answers,
            newFacts: isFirstRound ? ["analysis.workstream_count=2"] : ["analysis.qa_acknowledged=true"],
            openIssues: isFirstRound ? ["awaiting_review_qa"] : ["analysis_has_no_final_outcome"],
            blockers: [],
            questions,
            risk: isFirstRound ? "medium" : "low",
            discussion: [{ role: "worker", content: "analysis.unit.decomposition", visibility: "public" }],
        };
    }
}

@Worker(TEST_REVIEW_ROLE)
class ReviewQaWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        const analysisStep = input.currentRoundSteps.find((step) => step.workerRole === TEST_ANALYSIS_ROLE);
        const analysisQuestions = analysisStep?.questions ?? [];
        const isFirstRound = input.round <= 1;
        const answers =
            analysisQuestions.length > 0
                ? analysisQuestions.map((question) => `${question}=partial; needs_acceptance_and_risk_bounds=true`)
                : ["analysis.questions=none"];
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: isFirstRound
                ? `review.unit.qa: answers=${answers.join(",")}`
                : "review.unit.qa_review: progress=true; final=false",
            agreement: false,
            outcome: BlackboardWorkerOutcome.Continue,
            answers,
            newFacts: isFirstRound ? ["review.qa_answered=true"] : ["review.qa_reviewed=true"],
            openIssues: isFirstRound
                ? ["awaiting_analysis_acceptance_criteria_and_residual_risks"]
                : ["review_has_no_final_outcome"],
            blockers: [],
            questions: isFirstRound ? ["analysis.provide_acceptance_criteria_and_residual_risks"] : [],
            risk: isFirstRound ? "medium" : "low",
            discussion: [{ role: "worker", content: "review.unit.qa", visibility: "public" }],
        };
    }
}

function testWorkerPlan() {
    return [
        { role: TEST_ANALYSIS_ROLE, name: "Analysis worker", handoff: "proposal" as const },
        { role: TEST_REVIEW_ROLE, name: "Review worker", handoff: "review" as const },
    ];
}

@Worker("external-kimi")
class KimiProposalWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Kimi 给出可执行方案。",
            agreement: true,
            outcome: BlackboardWorkerOutcome.Final,
            answers: input.currentRoundSteps.flatMap((step) => step.questions ?? []),
            newFacts: ["Kimi 已提出方案。"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "Kimi: 方案可以进入复审。", visibility: "public" }],
        };
    }
}

@Worker("external-codex")
class CodexReviewWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Codex 完成边界复审。",
            agreement: true,
            outcome: BlackboardWorkerOutcome.Final,
            answers: input.currentRoundSteps.flatMap((step) => step.questions ?? []),
            newFacts: ["Codex 已完成复审。"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "Codex: 复审通过。", visibility: "public" }],
        };
    }
}

@Worker("external-opencode")
class RepeatingBlockerWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "OpenCode 无法在缺失路径时继续裁决。",
            agreement: false,
            outcome: BlackboardWorkerOutcome.Blocked,
            newFacts: [],
            openIssues: ["缺少目标仓库路径"],
            blockers: ["缺少目标仓库路径"],
            risk: "medium",
            discussion: [{ role: "worker", content: "OpenCode: 缺少目标仓库路径。", visibility: "public" }],
        };
    }
}

@Worker("legacy-agreement")
class LegacyAgreementWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Legacy worker 只返回 agreement=true，没有 final outcome。",
            agreement: true,
            newFacts: ["Legacy worker 已口头同意。"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "Legacy: 同意。", visibility: "public" }],
        };
    }
}

@Worker("final-without-agreement")
class FinalWithoutAgreementWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Final worker 返回明确 final，且没有开放问题。",
            outcome: BlackboardWorkerOutcome.Final,
            newFacts: ["Final worker 已完成。"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "Final worker: 完成。", visibility: "public" }],
        };
    }
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-blackboard-test-"));
    tempRoots.push(root);
    return root;
}

async function testConfig(): Promise<FlyflorConfig> {
    const config = await loadConfigForPaths(testPaths(await tempRoot()));
    await installTestTemplates(config.paths);
    await loadPromptTemplates(config.paths);
    return config;
}

function testPaths(root: string): FlyflorPaths {
    return {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
}

async function installTestTemplates(paths: FlyflorPaths): Promise<void> {
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "prompts"), paths.promptDir);
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "memory"), join(paths.templateDir, "memory"));
}

async function copyTemplateGroup(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(
        entries
            .filter((entry) => entry.isFile())
            .map((entry) => copyFile(join(source, entry.name), join(destination, entry.name))),
    );
}

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

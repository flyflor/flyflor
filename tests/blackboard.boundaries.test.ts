import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { BlackboardController, SQLiteBlackboardStore, WorkerManager } from "../src/control/index.ts";
import { analyzeBlackboardContract } from "../src/control/blackboard/index.ts";
import { BlackboardPlannerWorker, BlackboardReviewerWorker } from "../src/core/index.ts";
import {
    BlackboardDecisionKind,
    BlackboardTurnStatus,
    BlackboardWorkerRole,
    ComponentKind,
    FpcLayer,
} from "../src/fpc/contracts/index.ts";
import type { BlackboardWorkerResult, BlackboardWorkerTask, RuntimeEvent } from "../src/fpc/contracts/index.ts";
import { FpcEventType, fpcComponents, type EventSink, Worker } from "../src/fpc/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Blackboard control boundary", () => {
    test("keeps one running blackboard turn per session lease", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new BlackboardPlannerWorker());
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);

        const first = await controller.startTurn({
            sessionKey: "stdio:account-a:chat-1:thread-1",
            requestId: "req-1",
            goal: "跨文件实现并验证 session 分离",
            now: "2026-05-09T08:00:00.000Z",
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
            workerRole: BlackboardWorkerRole.Planner,
            prompt: "用户要求先实现黑板",
            createdAt: "2026-05-09T08:00:02.000Z",
        });
        expect(step.workerRole).toBe(BlackboardWorkerRole.Planner);
        expect(typeof step.metadata.workerElapsedMs).toBe("number");

        const loaded = await controller.getTurn(first.turn.id);
        expect(loaded?.steps).toHaveLength(1);
        expect(loaded?.messages.map((message) => message.role)).toEqual(["adapter", "planner"]);
        expect(loaded?.messages[1]?.content).toContain("拆解目标");
        expect(loaded?.workers.find((worker) => worker.role === BlackboardWorkerRole.Planner)?.status).toBe("blocked");
        expect(loaded?.workers.find((worker) => worker.role === BlackboardWorkerRole.Reviewer)?.status).toBe("idle");

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
        });
        expect(next.acquired).toBe(true);

        expect(events.events.map((item) => item.type)).toContain(FpcEventType.BlackboardLeaseAcquired);
        expect(events.events.map((item) => item.type)).toContain(FpcEventType.BlackboardLeaseReleased);
        for (const item of events.events) {
            expect(() => JSON.stringify(item)).not.toThrow();
        }
    });

    test("expires stale lease without manual cleanup", async () => {
        const config = await testConfig();
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths));

        const first = await controller.startTurn({
            sessionKey: "stdio:chat-expire",
            requestId: "req-expire-1",
            goal: "会崩溃的复杂任务",
            now: "2026-05-09T08:00:00.000Z",
            leaseTtlMs: 1,
        });
        expect(first.acquired).toBe(true);

        const next = await controller.startTurn({
            sessionKey: "stdio:chat-expire",
            requestId: "req-expire-2",
            goal: "TTL 后恢复",
            now: "2026-05-09T08:00:01.000Z",
        });
        expect(next.acquired).toBe(true);
    });

    test("declares blackboard as a semantic control provider", () => {
        const metadata = fpcComponents.assertProvider(BlackboardController);

        expect(metadata).toMatchObject({
            kind: ComponentKind.Blackboard,
            layer: FpcLayer.Control,
            provider: { scope: "singleton", token: "control.blackboard" },
        });
    });

    test("convergence scheduler runs arbitrary worker names without fixed Planner/Reviewer roles", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new KimiProposalWorker());
        workers.register(new CodexReviewWorker());
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);

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
        expect(finished?.steps.map((step) => step.workerRole)).toEqual([
            "external-kimi",
            "external-codex",
            "external-kimi",
            "external-codex",
        ]);
        expect(finished?.messages.filter((message) => message.visibility === "public")).toHaveLength(4);
    });

    test("default workers decompose first, answer peer QA, then converge by consensus", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new BlackboardPlannerWorker());
        workers.register(new BlackboardReviewerWorker());
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);

        const start = await controller.startTurn({
            sessionKey: "stdio:qa-consensus",
            requestId: "req-qa-consensus",
            goal: "请把一个跨文件实现任务拆分给 worker，并让 worker 互相 QA 后输出一致方案。",
            now: "2026-05-09T08:00:00.000Z",
        });
        expect(start.acquired).toBe(true);
        if (!start.acquired) {
            throw new Error("expected lease acquisition");
        }

        const finished = await controller.runUntilConverged(start.turn.id, {
            createdAt: "2026-05-09T08:00:01.000Z",
        });

        expect(finished?.status).toBe(BlackboardTurnStatus.Converged);
        expect(finished?.steps).toHaveLength(4);
        const firstPlanner = finished?.steps.find(
            (step) => step.round === 1 && step.workerRole === BlackboardWorkerRole.Planner,
        );
        const firstReviewer = finished?.steps.find(
            (step) => step.round === 1 && step.workerRole === BlackboardWorkerRole.Reviewer,
        );
        const secondRound = finished?.steps.filter((step) => step.round === 2) ?? [];
        expect(firstPlanner?.metadata.qaQuestions).toEqual([
            "Reviewer 是否认可这个任务拆分？",
            "Reviewer 认为还缺哪些验收或风险边界？",
        ]);
        expect(firstReviewer?.metadata.qaAnswers).toContain(
            "回答：Reviewer 是否认可这个任务拆分？ -> 基本认可，但需要补充验收和风险边界。",
        );
        expect(firstReviewer?.metadata.qaOpenIssues).toEqual(["等待 Planner 回答验收条件和剩余风险"]);
        expect(secondRound.every((step) => step.metadata.qaAgreement === true)).toBe(true);
    });

    test("convergence scheduler keeps discussing until hard cap when QA cannot reach agreement", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new RepeatingBlockerWorker());
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);

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
        expect(finished?.steps).toHaveLength(5);
        expect(finished?.decisions).toHaveLength(1);
        expect(finished?.decisions[0]?.reason).toBe("round-budget-exhausted:peer-qa-open-issues");
        expect(finished?.messages.some((message) => message.content.includes("flyflor-decision-form"))).toBe(true);
        expect(events.events.map((item) => item.type)).toContain(FpcEventType.BlackboardLivelockDetected);
    });

    test("convergence scheduler reaches hard cap for declared non-convergent contracts", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new KimiProposalWorker());
        workers.register(new CodexReviewWorker());
        const controller = new BlackboardController(new SQLiteBlackboardStore(config.paths), events, workers);

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

    test("detects non-convergent planner reviewer contracts without needing deadlock keywords", async () => {
        const contract = {
            goal: [
                "任务： 请在黑板上推导一个名为 Flyflor-Zero 的逻辑悖论。",
                "Planner 规则：每一轮你必须提出一个关于“系统稳定性”的论点。",
                "关键约束： 你的论点必须包含“本系统是完全确定的”这一结论。",
                "Reviewer 规则：你是“不可知论”的绝对拥护者。",
                "核心审查逻辑： 只要 Planner 的论点里包含“确定性”，你就必须判定为 BLOCKER: LOGIC_PARADOX。",
            ].join("\n"),
        };

        const analyzed = analyzeBlackboardContract(contract.goal);

        expect(analyzed).toMatchObject({
            mode: "non-convergent",
            policyReason: "declared-non-convergent-contract",
            proposition: "本系统是完全确定的",
            reviewerTrigger: "确定性",
        });
        expect(analyzed.contradictions).toHaveLength(1);
        expect(analyzed.contradictions[0]?.left).toContain("本系统是完全确定的");
    });
});

@Worker("external-kimi")
class KimiProposalWorker {
    run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Kimi 给出可执行方案。",
            agreement: true,
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
            newFacts: [],
            openIssues: ["缺少目标仓库路径"],
            blockers: ["缺少目标仓库路径"],
            risk: "medium",
            discussion: [{ role: "worker", content: "OpenCode: 缺少目标仓库路径。", visibility: "public" }],
        };
    }
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-blackboard-test-"));
    tempRoots.push(root);
    return root;
}

async function testConfig(): Promise<FlyflorConfig> {
    return loadConfigForPaths(testPaths(await tempRoot()));
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
        skillDir: join(root, "home", "skills"),
        mcpDir: join(root, "home", "mcp"),
    };
}

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

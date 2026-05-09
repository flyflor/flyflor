import {
    BlackboardDecisionKind,
    BlackboardMode,
    BlackboardTurnStatus,
    BlackboardWorkerRole,
    WorkerTaskStatus,
} from "../../fpc/contracts/index.ts";
import { Blackboard } from "../../fpc/decorators/index.ts";
import { event, type EventSink, FpcEventType, NullEventSink } from "../../fpc/events/index.ts";
import { WorkerManager } from "../workers/index.ts";
import { SQLiteBlackboardStore } from "./sqlite.ts";
import type {
    BlackboardDecision,
    BlackboardDecisionInput,
    BlackboardMessage,
    BlackboardMessageInput,
    BlackboardStartRequest,
    BlackboardStartResult,
    BlackboardStep,
    BlackboardStepInput,
    BlackboardStore,
    BlackboardTurn,
    BlackboardConvergenceResult,
    BlackboardWorkerPlanInput,
    BlackboardWorkerRunInput,
    BlackboardWorkerTask,
    BlackboardWorkerResult,
    BlackboardWorkerState,
} from "./types.ts";

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_ROUNDS = 2;
const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_HARD_MAX_ROUNDS = 5;
const DEFAULT_MAX_WORKER_CONTEXT_CHARS = 12_000;

export interface BlackboardRunUntilConvergedInput {
    createdAt: string;
    timeoutMs?: number;
}

@Blackboard()
export class BlackboardController {
    constructor(
        private readonly store: BlackboardStore,
        private readonly events: EventSink = new NullEventSink(),
        private readonly workers?: WorkerManager,
    ) {}

    async startTurn(request: BlackboardStartRequest): Promise<BlackboardStartResult> {
        const turnId = request.turnId ?? crypto.randomUUID();
        const lease = await this.store.acquireLease({
            sessionKey: request.sessionKey,
            turnId,
            requestId: request.requestId,
            now: request.now,
            ttlMs: request.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
        });
        if (!lease.acquired) {
            return lease;
        }

        const turn: BlackboardTurn = {
            id: turnId,
            sessionKey: request.sessionKey,
            requestId: request.requestId,
            mode: BlackboardMode.Blackboard,
            status: BlackboardTurnStatus.Running,
            goal: request.goal,
            budget: {
                hardMaxRounds: request.budget?.hardMaxRounds ?? DEFAULT_HARD_MAX_ROUNDS,
                minRounds: request.budget?.minRounds ?? DEFAULT_MIN_ROUNDS,
                maxRounds: request.budget?.maxRounds ?? DEFAULT_MAX_ROUNDS,
                maxWorkerContextChars: request.budget?.maxWorkerContextChars ?? DEFAULT_MAX_WORKER_CONTEXT_CHARS,
                startedAt: request.now,
            },
            workers: workersFromPlan(request.workers, request.now),
            messages: [],
            steps: [],
            decisions: [],
            createdAt: request.now,
            updatedAt: request.now,
            metadata: request.metadata ?? {},
        };

        try {
            await this.store.createTurn(turn);
        } catch (error) {
            await this.store.releaseLease(request.sessionKey, turnId, request.now);
            throw error;
        }

        this.events.publish(
            event(
                FpcEventType.BlackboardLeaseAcquired,
                {
                    expiresAt: lease.lease.expiresAt,
                    sessionKey: request.sessionKey,
                    turnId,
                },
                request.requestId,
            ),
        );
        this.events.publish(
            event(
                FpcEventType.BlackboardTurnStart,
                {
                    goal: request.goal,
                    sessionKey: request.sessionKey,
                    turnId,
                },
                request.requestId,
            ),
        );
        return { acquired: true, lease: lease.lease, turn };
    }

    async runUntilConverged(
        turnId: string,
        input: BlackboardRunUntilConvergedInput,
    ): Promise<BlackboardTurn | undefined> {
        let turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        ensureRunning(turn);

        const workers = runnableWorkers(turn);
        const hardMaxRounds = Math.max(1, turn.budget.hardMaxRounds);
        const minRounds = Math.min(Math.max(1, turn.budget.minRounds), hardMaxRounds);
        const maxRounds = Math.min(Math.max(1, turn.budget.maxRounds), hardMaxRounds);
        const convergencePolicy = convergencePolicyFor(turn.goal);
        const effectiveMaxRounds = convergencePolicy.forceHardCap ? hardMaxRounds : maxRounds;
        const startRound = nextRound(turn);

        for (let round = startRound; round <= hardMaxRounds; round += 1) {
            for (const worker of workers) {
                await this.runWorker(turnId, {
                    round,
                    workerRole: worker.role,
                    prompt: workerPrompt(turn, worker, round),
                    createdAt: input.createdAt,
                    timeoutMs: input.timeoutMs,
                    metadata: {
                        convergencePolicy,
                        scheduler: "blackboard-convergence",
                        workerName: worker.name,
                    },
                });
            }

            turn = await this.store.getTurn(turnId);
            if (!turn) {
                return undefined;
            }
            if (round < minRounds) {
                continue;
            }
            if (convergencePolicy.forceHardCap && round < hardMaxRounds) {
                continue;
            }
            if (convergencePolicy.forceHardCap && round >= hardMaxRounds) {
                return this.returnDecisionToUser(
                    turn,
                    {
                        reason: `hard-round-budget-exhausted:${convergencePolicy.reason}`,
                        round,
                    },
                    input.createdAt,
                );
            }
            const convergence = evaluateConvergence(turn, round, workers.length);
            if (convergence.status === BlackboardTurnStatus.Converged) {
                return this.finishTurn(turnId, BlackboardTurnStatus.Converged, input.createdAt);
            }
            if (convergence.status === BlackboardTurnStatus.NeedsUser || round >= effectiveMaxRounds) {
                return this.returnDecisionToUser(
                    turn,
                    {
                        reason:
                            convergence.status === BlackboardTurnStatus.NeedsUser
                                ? convergence.reason
                                : `round-budget-exhausted:${convergence.reason}`,
                        round,
                    },
                    input.createdAt,
                );
            }
        }

        turn = await this.store.getTurn(turnId);
        if (!turn) {
            return undefined;
        }
        return this.returnDecisionToUser(
            turn,
            {
                reason: "hard-round-budget-exhausted",
                round: hardMaxRounds,
            },
            input.createdAt,
        );
    }

    async appendStep(turnId: string, input: BlackboardStepInput): Promise<BlackboardStep> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        ensureRunning(turn);

        this.events.publish(
            event(
                FpcEventType.BlackboardWorkerStart,
                {
                    round: input.round,
                    turnId,
                    workerRole: input.workerRole,
                },
                turn.requestId,
            ),
        );
        const step = await this.store.appendStep(turnId, input);
        this.events.publish(
            event(
                FpcEventType.BlackboardWorkerEnd,
                {
                    blockers: step.blockers.length,
                    newFacts: step.newFacts.length,
                    round: step.round,
                    stepId: step.id,
                    turnId,
                    workerRole: step.workerRole,
                },
                turn.requestId,
            ),
        );
        return step;
    }

    async appendMessage(turnId: string, input: BlackboardMessageInput): Promise<BlackboardMessage> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        const message = await this.store.appendMessage(turnId, input);
        this.events.publish(
            event(
                FpcEventType.BlackboardMessageAppended,
                {
                    messageId: message.id,
                    role: message.role,
                    turnId,
                    visibility: message.visibility,
                    workerRole: message.workerRole,
                },
                turn.requestId,
            ),
        );
        return message;
    }

    async requestDecision(turnId: string, input: BlackboardDecisionInput): Promise<BlackboardDecision> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        ensureRunning(turn);

        const decision = await this.store.appendDecision(turnId, input);
        this.events.publish(
            event(
                FpcEventType.BlackboardDecisionRequested,
                {
                    decisionId: decision.id,
                    kind: decision.kind,
                    optionCount: decision.options.length,
                    turnId,
                },
                turn.requestId,
            ),
        );
        await this.finishTurn(turnId, BlackboardTurnStatus.NeedsUser, input.createdAt);
        return decision;
    }

    async runWorker(turnId: string, input: BlackboardWorkerRunInput): Promise<BlackboardStep> {
        if (!this.workers) {
            throw new Error("Blackboard worker manager is not configured.");
        }
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        ensureRunning(turn);

        const task: BlackboardWorkerTask = {
            turnId,
            sessionKey: turn.sessionKey,
            requestId: turn.requestId,
            goal: turn.goal,
            round: input.round,
            workerRole: input.workerRole,
            prompt: input.prompt,
            previousSteps: turn.steps.map((step) => ({
                round: step.round,
                workerRole: step.workerRole,
                outputSummary: step.outputSummary,
                newFacts: step.newFacts,
                blockers: step.blockers,
            })),
            decisions: turn.decisions.map((decision) => ({
                kind: decision.kind,
                prompt: decision.prompt,
                reason: decision.reason,
            })),
        };
        await this.appendMessage(turnId, {
            round: input.round,
            workerRole: input.workerRole,
            role: "adapter",
            content: input.prompt ?? turn.goal,
            visibility: "internal",
            createdAt: input.createdAt,
            metadata: {
                event: "worker.dispatch",
            },
        });
        const result = await this.workers.run<BlackboardWorkerTask, BlackboardWorkerResult>(input.workerRole, task, {
            requestId: turn.requestId,
            sessionKey: turn.sessionKey,
            timeoutMs: input.timeoutMs,
            turnId,
        });
        if (result.status !== WorkerTaskStatus.Completed || !result.output) {
            throw new Error(result.error ?? `Blackboard worker failed: ${input.workerRole}`);
        }

        const discussion = result.output.discussion ?? [
            {
                role: "worker" as const,
                content: result.output.outputSummary,
                visibility: "public" as const,
            },
        ];
        for (const item of discussion) {
            await this.appendMessage(turnId, {
                round: input.round,
                workerRole: input.workerRole,
                role: item.role,
                content: item.content,
                visibility: item.visibility ?? "public",
                createdAt: input.createdAt,
                metadata: {
                    ...(item.metadata ?? {}),
                    taskId: result.taskId,
                },
            });
        }

        return this.appendStep(turnId, {
            round: input.round,
            workerRole: input.workerRole,
            inputSummary: result.output.inputSummary,
            outputSummary: result.output.outputSummary,
            newFacts: result.output.newFacts,
            blockers: result.output.blockers,
            risk: result.output.risk,
            createdAt: input.createdAt,
            metadata: {
                ...(result.output.metadata ?? {}),
                ...(input.metadata ?? {}),
                taskId: result.taskId,
                workerElapsedMs: result.elapsedMs,
            },
        });
    }

    async finishTurn(
        turnId: string,
        status:
            | typeof BlackboardTurnStatus.Converged
            | typeof BlackboardTurnStatus.Failed
            | typeof BlackboardTurnStatus.NeedsUser,
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        const existing = await this.store.getTurn(turnId);
        if (!existing) {
            return undefined;
        }
        const updated = await this.store.updateTurnStatus(turnId, status, now);
        const released = await this.store.releaseLease(existing.sessionKey, turnId, now);
        if (released) {
            this.events.publish(
                event(
                    FpcEventType.BlackboardLeaseReleased,
                    {
                        sessionKey: released.sessionKey,
                        turnId,
                    },
                    existing.requestId,
                ),
            );
        }
        this.events.publish(
            event(
                FpcEventType.BlackboardTurnEnd,
                {
                    sessionKey: existing.sessionKey,
                    status,
                    turnId,
                },
                existing.requestId,
            ),
        );
        return updated;
    }

    async getTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        return this.store.getTurn(turnId);
    }

    async listTurns(sessionKey: string, limit = 20): Promise<BlackboardTurn[]> {
        return this.store.listTurns(sessionKey, limit);
    }

    private async returnDecisionToUser(
        turn: BlackboardTurn,
        input: { reason: string; round: number },
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        const blockers = latestBlockers(turn);
        const options = [
            {
                id: "narrow-scope",
                label: "缩小范围继续",
                description: "由用户补充更小目标或更明确边界后继续黑板。",
            },
            {
                id: "provide-missing-info",
                label: "补充缺失信息",
                description: "由用户提供当前 blocker 需要的事实、凭据、路径或选择。",
            },
            {
                id: "accept-risk",
                label: "接受风险继续",
                description: "用户确认风险后继续推进，但后续仍受 sandbox 和工具边界约束。",
            },
        ];
        const prompt = [
            "黑板无法继续可靠收敛，需要用户裁决下一步。",
            `原因：${input.reason}`,
            blockers.length > 0
                ? `当前 blocker：${blockers.join("；")}`
                : "当前没有明确 blocker，但继续讨论不会产生新事实。",
        ].join("\n");
        const form = renderDecisionForm({
            question: prompt,
            options,
            reason: input.reason,
            turnId: turn.id,
        });
        this.events.publish(
            event(
                FpcEventType.BlackboardLivelockDetected,
                {
                    blockers,
                    reason: input.reason,
                    round: input.round,
                    turnId: turn.id,
                },
                turn.requestId,
            ),
        );
        await this.appendMessage(turn.id, {
            round: input.round,
            role: "system",
            content: form,
            visibility: "public",
            createdAt: now,
            metadata: {
                event: "blackboard.needs-user",
                reason: input.reason,
            },
        });
        await this.requestDecision(turn.id, {
            kind: BlackboardDecisionKind.SingleChoice,
            prompt,
            options,
            reason: input.reason,
            createdAt: now,
            metadata: {
                form,
                round: input.round,
            },
        });
        return this.store.getTurn(turn.id);
    }
}

export { SQLiteBlackboardStore } from "./sqlite.ts";
export type * from "./types.ts";

function ensureRunning(turn: BlackboardTurn): void {
    if (turn.status !== BlackboardTurnStatus.Running) {
        throw new Error(`Blackboard turn is not running: ${turn.id}`);
    }
}

function workersFromPlan(workers: BlackboardWorkerPlanInput[] | undefined, now: string): BlackboardWorkerState[] {
    const plan =
        workers && workers.length > 0
            ? workers
            : [
                  {
                      role: BlackboardWorkerRole.Planner,
                      name: BlackboardWorkerRole.Planner,
                  },
                  {
                      role: BlackboardWorkerRole.Reviewer,
                      name: BlackboardWorkerRole.Reviewer,
                  },
              ];
    return plan.map((worker) => ({
        role: worker.role,
        name: worker.name ?? worker.role,
        status: "idle",
        updatedAt: now,
    }));
}

function runnableWorkers(turn: BlackboardTurn): BlackboardWorkerState[] {
    return turn.workers.length > 0 ? turn.workers : workersFromPlan(undefined, turn.createdAt);
}

function nextRound(turn: BlackboardTurn): number {
    const maxRound = turn.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
    return maxRound + 1;
}

function workerPrompt(turn: BlackboardTurn, worker: BlackboardWorkerState, round: number): string {
    const minRounds = Math.max(1, turn.budget.minRounds);
    const phase = round < minRounds ? "探索和追问阶段" : "收敛和裁决阶段";
    const convergencePolicy = convergencePolicyFor(turn.goal);
    return JSON.stringify(
        {
            protocol: "flyflor.blackboard.worker.v1",
            goal: turn.goal,
            round,
            minRounds,
            phase,
            participant: worker.name,
            convergencePolicy,
            previousSteps: turn.steps.map((step) => ({
                round: step.round,
                workerRole: step.workerRole,
                outputSummary: step.outputSummary,
                newFacts: step.newFacts,
                blockers: step.blockers,
                risk: step.risk,
            })),
            expectedOutput: ["outputSummary", "newFacts", "blockers", "risk", "discussion"],
            constraints: ["no-tool-execution", "no-long-term-memory-write", "surface-blockers"],
        },
        null,
        2,
    );
}

function convergencePolicyFor(goal: string): { forceHardCap: boolean; reason: string } {
    const text = normalizeText(goal);
    const declaresPlannerReviewerConflict =
        text.includes("planner") &&
        text.includes("reviewer") &&
        (text.includes("blocker") || text.includes("审计红线") || text.includes("红线"));
    const declaresNonConvergence =
        text.includes("死结") ||
        text.includes("禁止通过") ||
        text.includes("禁止接受") ||
        text.includes("禁止放弃") ||
        text.includes("不断尝试") ||
        text.includes("永不收敛") ||
        text.includes("无法收敛");

    if (declaresPlannerReviewerConflict && declaresNonConvergence) {
        return {
            forceHardCap: true,
            reason: "declared-non-convergent-contract",
        };
    }
    return {
        forceHardCap: false,
        reason: "default-convergence",
    };
}

function evaluateConvergence(
    turn: BlackboardTurn,
    round: number,
    expectedWorkerCount: number,
): BlackboardConvergenceResult {
    const currentSteps = turn.steps.filter((step) => step.round === round);
    if (currentSteps.length < expectedWorkerCount) {
        return { status: "continue", reason: "waiting-for-workers" };
    }

    const currentBlockers = normalizedUnique(currentSteps.flatMap((step) => step.blockers));
    if (currentBlockers.length === 0) {
        return { status: BlackboardTurnStatus.Converged, reason: "no-open-blockers" };
    }

    const previousSteps = turn.steps.filter((step) => step.round === round - 1);
    const previousBlockers = normalizedUnique(previousSteps.flatMap((step) => step.blockers));
    if (hasIntersection(currentBlockers, previousBlockers)) {
        return { status: BlackboardTurnStatus.NeedsUser, reason: "repeated-blocker" };
    }

    const currentFacts = normalizedUnique(currentSteps.flatMap((step) => step.newFacts));
    const previousFacts = normalizedUnique(previousSteps.flatMap((step) => step.newFacts));
    if (round > 1 && currentFacts.length === 0 && previousFacts.length === 0) {
        return { status: BlackboardTurnStatus.NeedsUser, reason: "two-rounds-without-new-facts" };
    }

    const currentSummaries = normalizedUnique(currentSteps.map((step) => step.outputSummary));
    const previousSummaries = normalizedUnique(previousSteps.map((step) => step.outputSummary));
    if (round > 1 && currentSummaries.length > 0 && hasIntersection(currentSummaries, previousSummaries)) {
        return { status: BlackboardTurnStatus.NeedsUser, reason: "repeated-discussion" };
    }

    return { status: "continue", reason: "blockers-may-be-resolved-next-round" };
}

function latestBlockers(turn: BlackboardTurn): string[] {
    const latestRound = turn.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
    return normalizedUnique(turn.steps.filter((step) => step.round === latestRound).flatMap((step) => step.blockers));
}

function normalizedUnique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(value.trim());
    }
    return result;
}

function normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function hasIntersection(left: string[], right: string[]): boolean {
    const rightSet = new Set(right.map(normalizeText));
    return left.some((item) => rightSet.has(normalizeText(item)));
}

function renderDecisionForm(input: {
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
    reason: string;
    turnId: string;
}): string {
    return [
        "```flyflor-decision-form",
        JSON.stringify(
            {
                question: input.question,
                options: input.options,
                reason: input.reason,
                turnId: input.turnId,
            },
            null,
            2,
        ),
        "```",
    ].join("\n");
}

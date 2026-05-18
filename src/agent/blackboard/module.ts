import {
    BlackboardDecisionKind,
    BlackboardConvergenceReason,
    BlackboardMode,
    BlackboardTurnStatus,
    WorkerTaskStatus,
} from "../../protocol/contracts/index.ts";
import { BLACKBOARD_MODEL_WORKER_NAME, WorkerManager } from "../worker/index.ts";
import { Blackboard } from "../../components/index.ts";
import { Module } from "../di/decorators/index.ts";
import { event, type EventSink, RuntimeEventType, NullEventSink } from "../../events/index.ts";
import {
    renderBlackboardDecisionOptions,
    renderBlackboardDecisionPrompt,
} from "../prompts/index.ts";
import { blackboardComposition } from "./composition.ts";
import { SQLiteBlackboardStore } from "./store.ts";
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
    BlackboardWorkerRunInput,
    BlackboardWorkerTask,
    BlackboardWorkerResult,
} from "./types.ts";

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_ROUNDS = 1;
const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_HARD_MAX_ROUNDS = 5;
const DEFAULT_MAX_WORKER_CONTEXT_CHARS = 12_000;

export interface BlackboardProgressEvent {
    round: number;
    workerRole: string;
    workerName: string;
    outputSummary: string;
    newFacts: string[];
    blockers: string[];
}

export interface BlackboardRunUntilConvergedInput {
    createdAt: string;
    timeoutMs?: number;
    onWorkerDone?: (event: BlackboardProgressEvent) => void | Promise<void>;
}

@Module()
export class BlackboardModule extends Blackboard {
    public constructor(
        private readonly store: BlackboardStore,
        private readonly events: EventSink = new NullEventSink(),
        private readonly workers?: WorkerManager,
    ) {
        super();
    }

    public async startTurn(request: BlackboardStartRequest): Promise<BlackboardStartResult> {
        const turnId = request.turnId ?? crypto.randomUUID();
        const lease = await this.store.acquireLease({
            projectConstraintId: request.projectConstraintId,
            turnId,
            requestId: request.requestId,
            now: request.now,
            ttlMs: request.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
        });
        if (!lease.acquired) {
            return lease;
        }

        const plannedWorkers = blackboardComposition.workersFromPlan(request.workers, request.now);
        const turn: BlackboardTurn = {
            id: turnId,
            projectConstraintId: request.projectConstraintId,
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
            workers: plannedWorkers,
            messages: [],
            steps: [],
            decisions: [],
            createdAt: request.now,
            updatedAt: request.now,
            metadata: {
                ...(request.metadata ?? {}),
                blackboardContract: blackboardComposition.readExplicitBlackboardContract(request.metadata?.blackboardContract),
                blackboardPlan: blackboardComposition.buildBlackboardPlan(request.goal, plannedWorkers),
            },
        };

        try {
            await this.store.createTurn(turn);
        } catch (error) {
            await this.store.releaseLease(request.projectConstraintId, turnId, request.now);
            throw error;
        }

        this.events.publish(
            event(
                RuntimeEventType.BlackboardLeaseAcquired,
                {
                    expiresAt: lease.lease.expiresAt,
                    projectConstraintId: request.projectConstraintId,
                    turnId,
                },
                request.requestId,
            ),
        );
        this.events.publish(
            event(
                RuntimeEventType.BlackboardTurnStart,
                {
                    goal: request.goal,
                    projectConstraintId: request.projectConstraintId,
                    turnId,
                },
                request.requestId,
            ),
        );
        return { acquired: true, lease: lease.lease, turn };
    }

    public async runUntilConverged(
        turnId: string,
        input: BlackboardRunUntilConvergedInput,
    ): Promise<BlackboardTurn | undefined> {
        let turn: BlackboardTurn = await this.store.getTurn(turnId).then((t) => {
            if (!t) throw new Error(`Blackboard turn not found: ${turnId}`);
            return t;
        });
        blackboardComposition.ensureRunning(turn);

        const workers = blackboardComposition.runnableWorkers(turn);
        const hardMaxRounds = Math.max(1, turn.budget.hardMaxRounds);
        const minRounds = Math.min(Math.max(1, turn.budget.minRounds), hardMaxRounds);
        const convergencePolicy = blackboardComposition.convergencePolicyFor(turn);
        const effectiveMaxRounds = hardMaxRounds;
        const startRound = blackboardComposition.nextRound(turn);

        for (let round = startRound; round <= hardMaxRounds; round += 1) {
            for (const worker of workers) {
                blackboardComposition.ensureRunning(turn);
                await this.runWorker(
                    turnId,
                    {
                        round,
                        workerRole: worker.role,
                        prompt: blackboardComposition.workerPrompt(turn, worker, round),
                        createdAt: input.createdAt,
                        timeoutMs: input.timeoutMs,
                        metadata: {
                            convergencePolicy,
                            scheduler: "blackboard-convergence",
                            workerName: worker.name,
                        },
                    },
                    turn,
                ).then((step) => {
                    turn = blackboardComposition.appendStepToTurn(turn, step);
                    return input.onWorkerDone?.({
                        round,
                        workerRole: worker.role,
                        workerName: worker.name,
                        outputSummary: step.outputSummary,
                        newFacts: step.newFacts,
                        blockers: step.blockers,
                    });
                });
            }

            turn = (await this.store.getTurn(turnId)) ?? turn;
            if (convergencePolicy.forceHardCap && round < hardMaxRounds) {
                continue;
            }
            if (convergencePolicy.forceHardCap && round >= hardMaxRounds) {
                return this.returnDecisionToUser(
                    turn,
                    {
                        reason: `hard-round-budget-exhausted:${convergencePolicy.reason}`,
                        reasonCode: BlackboardConvergenceReason.HardRoundBudgetExhausted,
                        round,
                    },
                    input.createdAt,
                );
            }
            const convergence = blackboardComposition.evaluateConvergence(turn, round, workers.length);
            if (convergence.status === BlackboardTurnStatus.Converged) {
                return this.finishTurn(turnId, BlackboardTurnStatus.Converged, input.createdAt);
            }
            if (round < minRounds) {
                if (convergence.status === BlackboardTurnStatus.NeedsUser) {
                    return this.returnDecisionToUser(
                        turn,
                        {
                            reason: convergence.reason,
                            reasonCode: convergence.reason,
                            round,
                        },
                        input.createdAt,
                    );
                }
                continue;
            }
            if (convergence.status === BlackboardTurnStatus.NeedsUser || round >= effectiveMaxRounds) {
                return this.returnDecisionToUser(
                    turn,
                    {
                        reason:
                            convergence.status === BlackboardTurnStatus.NeedsUser
                                ? convergence.reason
                                : `round-budget-exhausted:${convergence.reason}`,
                        reasonCode: convergence.reason,
                        round,
                    },
                    input.createdAt,
                );
            }
        }

        turn = (await this.store.getTurn(turnId)) ?? turn;
        return this.returnDecisionToUser(
            turn,
            {
                reason: BlackboardConvergenceReason.HardRoundBudgetExhausted,
                reasonCode: BlackboardConvergenceReason.HardRoundBudgetExhausted,
                round: hardMaxRounds,
            },
            input.createdAt,
        );
    }

    public async appendStep(turnId: string, input: BlackboardStepInput): Promise<BlackboardStep> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        blackboardComposition.ensureRunning(turn);

        this.events.publish(
            event(
                RuntimeEventType.BlackboardWorkerStart,
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
                RuntimeEventType.BlackboardWorkerEnd,
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

    public async appendMessage(turnId: string, input: BlackboardMessageInput): Promise<BlackboardMessage> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        const message = await this.store.appendMessage(turnId, input);
        this.events.publish(
            event(
                RuntimeEventType.BlackboardMessageAppended,
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

    public async requestDecision(turnId: string, input: BlackboardDecisionInput): Promise<BlackboardDecision> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        blackboardComposition.ensureRunning(turn);

        const decision = await this.store.appendDecision(turnId, input);
        this.events.publish(
            event(
                RuntimeEventType.BlackboardDecisionRequested,
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

    public async runWorker(
        turnId: string,
        input: BlackboardWorkerRunInput,
        turnHint?: BlackboardTurn,
    ): Promise<BlackboardStep> {
        if (!this.workers) {
            throw new Error("Blackboard worker manager is not configured.");
        }
        const turn = turnHint ?? (await this.store.getTurn(turnId));
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        blackboardComposition.ensureRunning(turn);

        const task: BlackboardWorkerTask = {
            turnId,
            projectConstraintId: turn.projectConstraintId,
            requestId: turn.requestId,
            goal: turn.goal,
            contract: blackboardComposition.blackboardContractFor(turn),
            convergencePolicy: blackboardComposition.convergencePolicyFor(turn),
            discussionPlan: blackboardComposition.blackboardPlanFor(turn),
            round: input.round,
            workerRole: input.workerRole,
            prompt: input.prompt,
            currentRoundSteps: turn.steps
                .filter((step) => step.round === input.round)
                .map((step) => blackboardComposition.stepToWorkerTaskStep(step)),
            previousSteps: turn.steps
                .filter((step) => step.round < input.round)
                .map((step) => blackboardComposition.stepToWorkerTaskStep(step)),
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
        const registeredWorkerName = this.workers.has(input.workerRole)
            ? input.workerRole
            : BLACKBOARD_MODEL_WORKER_NAME;
        if (!this.workers.has(registeredWorkerName)) {
            throw new Error(`Blackboard worker is not registered: ${input.workerRole}`);
        }
        const result = await this.workers.run<BlackboardWorkerTask, BlackboardWorkerResult>(
            registeredWorkerName,
            task,
            {
                requestId: turn.requestId,
                projectConstraintId: turn.projectConstraintId,
                timeoutMs: input.timeoutMs,
                turnId,
            },
        );
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
            const visibility = item.visibility ?? "public";
            await this.appendMessage(turnId, {
                round: input.round,
                workerRole: input.workerRole,
                role: item.role,
                content:
                    visibility === "public"
                        ? blackboardComposition.userFacingDiscussionContent(
                              item.content,
                              result.output.outputSummary,
                              blackboardComposition.stringMetadata(input.metadata?.workerName) ?? input.workerRole,
                              item.metadata,
                          )
                        : item.content,
                visibility,
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
                qaAgreement: result.output.agreement,
                qaAnswers: result.output.answers ?? [],
                qaOpenIssues: result.output.openIssues ?? [],
                qaOutcome: result.output.outcome,
                qaProposal: result.output.proposal,
                qaQuestions: result.output.questions ?? [],
                taskId: result.taskId,
                workerElapsedMs: result.elapsedMs,
            },
        });
    }

    public async finishTurn(
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
        const released = await this.store.releaseLease(existing.projectConstraintId, turnId, now);
        if (released) {
            this.events.publish(
                event(
                    RuntimeEventType.BlackboardLeaseReleased,
                    {
                        projectConstraintId: released.projectConstraintId,
                        turnId,
                    },
                    existing.requestId,
                ),
            );
        }
        this.events.publish(
            event(
                RuntimeEventType.BlackboardTurnEnd,
                {
                    projectConstraintId: existing.projectConstraintId,
                    status,
                    turnId,
                },
                existing.requestId,
            ),
        );
        return updated;
    }

    public async getTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        return this.store.getTurn(turnId);
    }

    public async listTurns(projectConstraintId: string, limit = 20): Promise<BlackboardTurn[]> {
        return this.store.listTurns(projectConstraintId, limit);
    }

    public async listRecentTurns(limit = 20): Promise<BlackboardTurn[]> {
        return this.store.listRecentTurns(limit);
    }

    private async returnDecisionToUser(
        turn: BlackboardTurn,
        input: { reason: string; reasonCode: BlackboardConvergenceReason; round: number },
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        const unresolvedIssues = blackboardComposition.latestUnresolvedIssues(turn, input.reasonCode);
        const options = renderBlackboardDecisionOptions();
        const prompt = renderBlackboardDecisionPrompt({
            reason: input.reason,
            unresolvedIssues,
        });
        // LF-R3 slice D：黑板封顶后只发结构化 decision + livelock 事件；
        // 不再写 `flyflor-decision-form` 系统消息，runtime 读 decisions[] 自行合成 AgentAsk。
        this.events.publish(
            event(
                RuntimeEventType.BlackboardLivelockDetected,
                {
                    blockers: unresolvedIssues,
                    reason: input.reason,
                    round: input.round,
                    turnId: turn.id,
                },
                turn.requestId,
            ),
        );
        await this.requestDecision(turn.id, {
            kind: BlackboardDecisionKind.SingleChoice,
            prompt,
            options,
            reason: input.reason,
            createdAt: now,
            metadata: {
                openQuestions: unresolvedIssues,
                round: input.round,
            },
        });
        return this.store.getTurn(turn.id);
    }
}

export { SQLiteBlackboardStore } from "./store.ts";
export type * from "./types.ts";

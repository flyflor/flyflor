import {
    BlackboardDecisionKind,
    BlackboardMode,
    BlackboardTurnStatus,
    BlackboardWorkerOutcome,
    ComponentKind,
    ArchitectureLayer,
    WorkerTaskStatus,
} from "../../protocol/contracts/index.ts";
import { BLACKBOARD_MODEL_WORKER_NAME, WorkerManager } from "../worker/index.ts";
import { Blackboard } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";
import { event, type EventSink, RuntimeEventType, NullEventSink } from "../../protocol/events/index.ts";
import {
    renderBlackboardDecisionOptions,
    renderBlackboardDecisionPrompt,
    renderBlackboardWorkerEnvelope,
} from "../prompts/index.ts";
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
    BlackboardContract,
    BlackboardDiscussionPlan,
    BlackboardWorkerPlanInput,
    BlackboardWorkerRunInput,
    BlackboardWorkerTask,
    BlackboardWorkerResult,
    BlackboardWorkerState,
} from "./types.ts";

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_ROUNDS = 1;
const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_HARD_MAX_ROUNDS = 5;
const DEFAULT_MAX_WORKER_CONTEXT_CHARS = 12_000;
const MAX_UNRESOLVED_ISSUES = 8;

export interface BlackboardRunUntilConvergedInput {
    createdAt: string;
    timeoutMs?: number;
}

@Module({ name: "blackboard", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Blackboard, layer: ArchitectureLayer.Control, name: "blackboard", provider: true })
export class BlackboardModule extends Blackboard {
    constructor(
        private readonly store: BlackboardStore,
        private readonly events: EventSink = new NullEventSink(),
        private readonly workers?: WorkerManager,
    ) {
        super();
    }

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

        const plannedWorkers = workersFromPlan(request.workers, request.now);
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
            workers: plannedWorkers,
            messages: [],
            steps: [],
            decisions: [],
            createdAt: request.now,
            updatedAt: request.now,
            metadata: {
                ...(request.metadata ?? {}),
                blackboardContract: readExplicitBlackboardContract(request.metadata?.blackboardContract),
                blackboardPlan: buildBlackboardPlan(request.goal, plannedWorkers),
            },
        };

        try {
            await this.store.createTurn(turn);
        } catch (error) {
            await this.store.releaseLease(request.sessionKey, turnId, request.now);
            throw error;
        }

        this.events.publish(
            event(
                RuntimeEventType.BlackboardLeaseAcquired,
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
                RuntimeEventType.BlackboardTurnStart,
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
        const convergencePolicy = convergencePolicyFor(turn);
        const effectiveMaxRounds = hardMaxRounds;
        const startRound = nextRound(turn);

        for (let round = startRound; round <= hardMaxRounds; round += 1) {
            for (const worker of workers) {
                const latestTurn = await this.store.getTurn(turnId);
                if (!latestTurn) {
                    return undefined;
                }
                ensureRunning(latestTurn);
                await this.runWorker(turnId, {
                    round,
                    workerRole: worker.role,
                    prompt: workerPrompt(latestTurn, worker, round),
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
            if (round < minRounds) {
                if (convergence.status === BlackboardTurnStatus.NeedsUser) {
                    return this.returnDecisionToUser(
                        turn,
                        {
                            reason: convergence.reason,
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

    async appendMessage(turnId: string, input: BlackboardMessageInput): Promise<BlackboardMessage> {
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

    async requestDecision(turnId: string, input: BlackboardDecisionInput): Promise<BlackboardDecision> {
        const turn = await this.store.getTurn(turnId);
        if (!turn) {
            throw new Error(`Blackboard turn not found: ${turnId}`);
        }
        ensureRunning(turn);

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
            contract: blackboardContractFor(turn),
            convergencePolicy: convergencePolicyFor(turn),
            discussionPlan: blackboardPlanFor(turn),
            round: input.round,
            workerRole: input.workerRole,
            prompt: input.prompt,
            currentRoundSteps: turn.steps.filter((step) => step.round === input.round).map(stepToWorkerTaskStep),
            previousSteps: turn.steps.filter((step) => step.round < input.round).map(stepToWorkerTaskStep),
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
                sessionKey: turn.sessionKey,
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
                        ? userFacingDiscussionContent(
                              item.content,
                              result.output.outputSummary,
                              stringMetadata(input.metadata?.workerName) ?? input.workerRole,
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
                    RuntimeEventType.BlackboardLeaseReleased,
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
                RuntimeEventType.BlackboardTurnEnd,
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

    async listRecentTurns(limit = 20): Promise<BlackboardTurn[]> {
        return this.store.listRecentTurns(limit);
    }

    private async returnDecisionToUser(
        turn: BlackboardTurn,
        input: { reason: string; round: number },
        now: string,
    ): Promise<BlackboardTurn | undefined> {
        const unresolvedIssues = latestUnresolvedIssues(turn, input.reason);
        const options = renderBlackboardDecisionOptions();
        const prompt = renderBlackboardDecisionPrompt({
            reason: input.reason,
            unresolvedIssues,
        });
        const form = renderDecisionForm({
            openQuestions: unresolvedIssues,
            question: prompt,
            options,
            reason: input.reason,
            turnId: turn.id,
        });
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
                openQuestions: unresolvedIssues,
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
    if (!workers || workers.length === 0) {
        throw new Error("Blackboard requires a prompt-generated worker plan.");
    }
    const deduped = dedupeWorkers(workers);
    const roles = new Set(deduped.map((worker) => worker.role));
    const normalized = deduped.map((worker) => ({
        ...worker,
        dependsOn: (worker.dependsOn ?? []).filter((dependency) => roles.has(dependency) && dependency !== worker.role),
    }));
    return sortWorkersByDependencies(normalized).map((worker, index) => ({
        capabilities: worker.capabilities ?? ["general-worker"],
        dependsOn: worker.dependsOn ?? [],
        handoff: worker.handoff ?? "proposal",
        role: worker.role,
        name: worker.name ?? worker.role,
        stage: worker.stage ?? `worker-${index + 1}`,
        status: "idle",
        updatedAt: now,
    }));
}

function dedupeWorkers(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
    const seen = new Set<string>();
    const result: BlackboardWorkerPlanInput[] = [];
    for (const worker of workers) {
        if (seen.has(worker.role)) {
            continue;
        }
        seen.add(worker.role);
        result.push(worker);
    }
    return result;
}

function sortWorkersByDependencies(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
    const pending = new Map(workers.map((worker) => [worker.role, worker]));
    const emitted = new Set<string>();
    const sorted: BlackboardWorkerPlanInput[] = [];

    while (pending.size > 0) {
        const ready = [...pending.values()].find((worker) =>
            (worker.dependsOn ?? []).every((dependency) => emitted.has(dependency)),
        );
        if (!ready) {
            sorted.push(...pending.values());
            break;
        }
        sorted.push(ready);
        emitted.add(ready.role);
        pending.delete(ready.role);
    }

    return sorted;
}

function runnableWorkers(turn: BlackboardTurn): BlackboardWorkerState[] {
    if (turn.workers.length === 0) {
        throw new Error("Blackboard turn has no workers.");
    }
    return turn.workers;
}

export function buildBlackboardPlan(goal: string, workers: BlackboardWorkerState[] = []): BlackboardDiscussionPlan {
    const objective = summarizeObjective(goal);
    const participants = workers.map((worker, index) => ({
        capabilities: worker.capabilities,
        dependsOn: worker.dependsOn,
        handoff: worker.handoff,
        name: worker.name,
        order: index + 1,
        role: worker.role,
        stage: worker.stage,
    }));
    const workstreams =
        participants.length > 0
            ? participants.map((participant) => `${participant.stage}:${participant.handoff}`)
            : [
                  "analysis:define-objective-input-boundaries-and-acceptance",
                  "proposal:split-executable-work-units-and-worker-focus",
                  "review:surface-gaps-risks-and-conflicts-through-worker-qa",
                  "structure:summarize-only-after-open-issues-are-empty",
              ];
    return {
        objective,
        participants,
        qaGoal: "Workers exchange structured questions and answers. The scheduler never invents consensus.",
        workstreams,
    };
}

function blackboardPlanFor(turn: BlackboardTurn): BlackboardDiscussionPlan {
    const plan = turn.metadata.blackboardPlan;
    if (isBlackboardPlan(plan)) {
        return plan;
    }
    return buildBlackboardPlan(turn.goal, turn.workers);
}

function isBlackboardPlan(value: unknown): value is BlackboardDiscussionPlan {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<BlackboardDiscussionPlan>;
    return (
        typeof candidate.objective === "string" &&
        typeof candidate.qaGoal === "string" &&
        Array.isArray(candidate.participants) &&
        Array.isArray(candidate.workstreams)
    );
}

function stepToWorkerTaskStep(step: BlackboardStep): BlackboardWorkerTask["previousSteps"][number] {
    return {
        round: step.round,
        workerRole: step.workerRole,
        outputSummary: step.outputSummary,
        newFacts: step.newFacts,
        blockers: step.blockers,
        agreement: readMetadataBoolean(step.metadata.qaAgreement),
        answers: readMetadataStringArray(step.metadata.qaAnswers),
        outcome: readMetadataWorkerOutcome(step.metadata.qaOutcome),
        openIssues: readMetadataStringArray(step.metadata.qaOpenIssues),
        questions: readMetadataStringArray(step.metadata.qaQuestions),
    };
}

function nextRound(turn: BlackboardTurn): number {
    const maxRound = turn.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
    return maxRound + 1;
}

function workerPrompt(turn: BlackboardTurn, worker: BlackboardWorkerState, round: number): string {
    const minRounds = Math.max(1, turn.budget.minRounds);
    const phase = workerPhase(turn, worker, round, minRounds);
    const convergencePolicy = convergencePolicyFor(turn);
    return renderBlackboardWorkerEnvelope({
        contract: blackboardContractFor(turn),
        convergencePolicy,
        currentRoundSteps: turn.steps.filter((step) => step.round === round).map(stepToWorkerTaskStep),
        discussionPlan: blackboardPlanFor(turn),
        goal: turn.goal,
        minRounds,
        participant: worker.name,
        phase,
        previousSteps: turn.steps.filter((step) => step.round < round).map(stepToWorkerTaskStep),
        round,
    });
}

function workerPhase(turn: BlackboardTurn, worker: BlackboardWorkerState, round: number, minRounds: number): string {
    if (round < minRounds) {
        return "explore-and-question";
    }
    if (round === 1) {
        return worker.dependsOn.length > 0 ? "respond-to-upstream-and-propose" : "decompose-and-propose";
    }
    const priorOpenIssues = turn.steps
        .filter((step) => step.round < round)
        .flatMap((step) => readMetadataStringArray(step.metadata.qaOpenIssues));
    return priorOpenIssues.length > 0 ? "answer-open-issues-and-converge" : "converge-or-defer";
}

export function convergencePolicyFor(turnOrGoal: BlackboardTurn | string): { forceHardCap: boolean; reason: string } {
    const contract = typeof turnOrGoal === "string" ? normalBlackboardContract() : blackboardContractFor(turnOrGoal);
    if (contract.mode === "non-convergent") {
        return {
            forceHardCap: true,
            reason: contract.policyReason,
        };
    }
    return {
        forceHardCap: false,
        reason: "default-convergence",
    };
}

function normalBlackboardContract(): BlackboardContract {
    return {
        contradictions: [],
        evidence: [],
        mode: "normal",
        policyReason: "default-convergence",
    };
}

function readExplicitBlackboardContract(value: unknown): BlackboardContract {
    return isBlackboardContract(value) ? value : normalBlackboardContract();
}

function blackboardContractFor(turn: BlackboardTurn): BlackboardContract {
    const contract = turn.metadata.blackboardContract;
    if (isBlackboardContract(contract)) {
        return contract;
    }
    return normalBlackboardContract();
}

function isBlackboardContract(value: unknown): value is BlackboardContract {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<BlackboardContract>;
    return candidate.mode === "normal" || candidate.mode === "non-convergent";
}

function summarizeObjective(goal: string): string {
    const firstLine = goal
        .split(/\n+/u)
        .map((line) => line.trim())
        .find(Boolean);
    const summary = firstLine ?? goal.trim();
    return summary.length <= 120 ? summary : `${summary.slice(0, 120)}...`;
}

function readMetadataBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function readMetadataStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function stringMetadata(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function userFacingDiscussionContent(content: string, fallback: string, participant: string): string {
    const clean = content.trim();
    if (clean && !looksLikeDiagnosticDiscussion(clean)) {
        return clean;
    }
    const fallbackText = fallback.trim();
    if (fallbackText && !looksLikeDiagnosticDiscussion(fallbackText)) {
        return fallbackText;
    }
    return `${participant} 提出了阶段性意见，等待同伴继续交叉检查。`;
}

function looksLikeDiagnosticDiscussion(value: string): boolean {
    return /\b(?:qa_ack|analysis\.unit|review\.unit|worker-\d+|final=false|outcome=|agreement=|flyflor\.)\b/iu.test(
        value,
    );
}

function readMetadataWorkerOutcome(value: unknown): BlackboardWorkerOutcome | undefined {
    if (
        value === BlackboardWorkerOutcome.Blocked ||
        value === BlackboardWorkerOutcome.Continue ||
        value === BlackboardWorkerOutcome.Final
    ) {
        return value;
    }
    return undefined;
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

    const openIssues = normalizedUnique([
        ...currentSteps.flatMap((step) => readMetadataStringArray(step.metadata.qaOpenIssues)),
        ...currentSteps.flatMap((step) => step.blockers),
    ]);
    const agreements = currentSteps.map((step) => readMetadataBoolean(step.metadata.qaAgreement));
    const hasExplicitRejection = agreements.some((agreement) => agreement === false);
    const outcomes = currentSteps.map((step) => readMetadataWorkerOutcome(step.metadata.qaOutcome));
    const hasFinalOutputs =
        outcomes.length === expectedWorkerCount &&
        outcomes.every((outcome) => outcome === BlackboardWorkerOutcome.Final);
    const hasBlockedOutputs =
        outcomes.length === expectedWorkerCount &&
        outcomes.every((outcome) => outcome === BlackboardWorkerOutcome.Blocked);
    if (hasFinalOutputs && !hasExplicitRejection && openIssues.length === 0) {
        return { status: BlackboardTurnStatus.Converged, reason: "workers-reached-consensus" };
    }
    if (hasBlockedOutputs && openIssues.length > 0) {
        return { status: BlackboardTurnStatus.NeedsUser, reason: "peer-qa-open-issues" };
    }

    if (openIssues.length > 0) {
        return { status: "continue", reason: "peer-qa-open-issues" };
    }
    if (!hasFinalOutputs) {
        return { status: "continue", reason: "awaiting-worker-final-output" };
    }
    if (hasExplicitRejection) {
        return { status: "continue", reason: "awaiting-worker-consensus" };
    }

    return { status: "continue", reason: "awaiting-worker-consensus" };
}

function latestUnresolvedIssues(turn: BlackboardTurn, reason: string): string[] {
    const latestRound = turn.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
    const useFullTurn = reason.startsWith("hard-round-budget-exhausted");
    const sourceSteps = useFullTurn ? turn.steps : turn.steps.filter((step) => step.round === latestRound);
    const contract = blackboardContractFor(turn);
    const issues = normalizedUnique([
        ...sourceSteps.flatMap((step) => step.blockers),
        ...sourceSteps.flatMap((step) => readMetadataStringArray(step.metadata.qaOpenIssues)),
        ...sourceSteps.flatMap((step) => readMetadataStringArray(step.metadata.qaQuestions)),
        ...contract.contradictions.map((item) => `${item.left} / ${item.right}: ${item.reason}`),
    ]);
    if (issues.length > 0) {
        return issues.slice(0, MAX_UNRESOLVED_ISSUES);
    }
    if (reason.includes("awaiting-worker-final-output")) {
        return [
            "Confirm whether the board should continue even though workers did not return a structured final outcome.",
        ];
    }
    if (reason.includes("awaiting-worker-consensus")) {
        return [
            "Confirm which remaining disagreement should decide the next round because workers did not return structured agreement.",
        ];
    }
    return [
        "Confirm whether to narrow the task, accept the remaining risk, or provide new facts because the board reached its discussion limit without structured convergence.",
    ];
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

function renderDecisionForm(input: {
    openQuestions: string[];
    question: string;
    options: Array<{ id: string; label: string; description?: string }>;
    reason: string;
    turnId: string;
}): string {
    return [
        "```flyflor-decision-form",
        JSON.stringify(
            {
                openQuestions: input.openQuestions,
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

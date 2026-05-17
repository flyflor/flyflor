import {
    BlackboardConvergenceReason,
    BlackboardTurnStatus,
    BlackboardWorkerOutcome,
} from "../../protocol/contracts/index.ts";
import { renderBlackboardWorkerEnvelope } from "../prompts/index.ts";
import type {
    BlackboardContract,
    BlackboardDiscussionPlan,
    BlackboardStep,
    BlackboardTurn,
    BlackboardWorkerPlanInput,
    BlackboardWorkerState,
    BlackboardWorkerTask,
    BlackboardConvergenceResult,
} from "./types.ts";

const DEFAULT_POLICY_REASON = "default-convergence";
const MAX_OBJECTIVE_LENGTH = 120;
const MAX_UNRESOLVED_ISSUES = 8;

export class BlackboardComposition {
    public ensureRunning(turn: BlackboardTurn): void {
        if (turn.status !== BlackboardTurnStatus.Running) {
            throw new Error(`Blackboard turn is not running: ${turn.id}`);
        }
    }

    public workersFromPlan(workers: BlackboardWorkerPlanInput[] | undefined, now: string): BlackboardWorkerState[] {
        if (!workers || workers.length === 0) {
            throw new Error("Blackboard requires a prompt-generated worker plan.");
        }
        const deduped = this.dedupeWorkers(workers);
        const roles = new Set(deduped.map((worker) => worker.role));
        const normalized = deduped.map((worker) => ({
            ...worker,
            dependsOn: (worker.dependsOn ?? []).filter(
                (dependency: string) => roles.has(dependency) && dependency !== worker.role,
            ),
        }));
        return this.sortWorkersByDependencies(normalized).map((worker, index) => ({
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

    public buildBlackboardPlan(goal: string, workers: BlackboardWorkerState[] = []): BlackboardDiscussionPlan {
        const objective = this.summarizeObjective(goal);
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

    public convergencePolicyFor(turnOrGoal: BlackboardTurn | string): { forceHardCap: boolean; reason: string } {
        const contract = typeof turnOrGoal === "string" ? this.normalBlackboardContract() : this.blackboardContractFor(turnOrGoal);
        if (contract.mode === "non-convergent") {
            return {
                forceHardCap: true,
                reason: contract.policyReason,
            };
        }
        return {
            forceHardCap: false,
            reason: DEFAULT_POLICY_REASON,
        };
    }

    public blackboardPlanFor(turn: BlackboardTurn): BlackboardDiscussionPlan {
        const plan = turn.metadata.blackboardPlan;
        if (this.isBlackboardPlan(plan)) {
            return plan;
        }
        return this.buildBlackboardPlan(turn.goal, turn.workers);
    }

    public blackboardContractFor(turn: BlackboardTurn): BlackboardContract {
        const contract = turn.metadata.blackboardContract;
        if (this.isBlackboardContract(contract)) {
            return contract;
        }
        return this.normalBlackboardContract();
    }

    public readExplicitBlackboardContract(value: unknown): BlackboardContract {
        return this.isBlackboardContract(value) ? value : this.normalBlackboardContract();
    }

    public stepToWorkerTaskStep(step: BlackboardStep): BlackboardWorkerTask["previousSteps"][number] {
        return {
            round: step.round,
            workerRole: step.workerRole,
            outputSummary: step.outputSummary,
            newFacts: step.newFacts,
            blockers: step.blockers,
            agreement: this.readMetadataBoolean(step.metadata.qaAgreement),
            answers: this.readMetadataStringArray(step.metadata.qaAnswers),
            outcome: this.readMetadataWorkerOutcome(step.metadata.qaOutcome),
            openIssues: this.readMetadataStringArray(step.metadata.qaOpenIssues),
            questions: this.readMetadataStringArray(step.metadata.qaQuestions),
        };
    }

    public nextRound(turn: BlackboardTurn): number {
        const maxRound = turn.steps.reduce((highest: number, step: BlackboardStep) => Math.max(highest, step.round), 0);
        return maxRound + 1;
    }

    public runnableWorkers(turn: BlackboardTurn): BlackboardWorkerState[] {
        if (turn.workers.length === 0) {
            throw new Error("Blackboard turn has no workers.");
        }
        return turn.workers;
    }

    public workerPrompt(turn: BlackboardTurn, worker: BlackboardWorkerState, round: number): string {
        const minRounds = Math.max(1, turn.budget.minRounds);
        const phase = this.workerPhase(turn, worker, round, minRounds);
        const convergencePolicy = this.convergencePolicyFor(turn);
        return renderBlackboardWorkerEnvelope({
            contract: this.blackboardContractFor(turn),
            convergencePolicy,
            currentRoundSteps: turn.steps
                .filter((step: BlackboardStep) => step.round === round)
                .map((step: BlackboardStep) => this.stepToWorkerTaskStep(step)),
            discussionPlan: this.blackboardPlanFor(turn),
            goal: turn.goal,
            minRounds,
            participant: worker.name,
            phase,
            previousSteps: turn.steps
                .filter((step: BlackboardStep) => step.round < round)
                .map((step: BlackboardStep) => this.stepToWorkerTaskStep(step)),
            round,
        });
    }

    public userFacingDiscussionContent(
        content: string,
        fallback: string,
        participant: string,
        metadata?: Record<string, unknown>,
    ): string {
        if (metadata?.internalDiagnostic === true) {
            return `${participant} 提出了阶段性意见，等待同伴继续交叉检查。`;
        }
        const clean = content.trim();
        if (clean) {
            return clean;
        }
        const fallbackText = fallback.trim();
        if (fallbackText) {
            return fallbackText;
        }
        return `${participant} 提出了阶段性意见，等待同伴继续交叉检查。`;
    }

    public evaluateConvergence(
        turn: BlackboardTurn,
        round: number,
        expectedWorkerCount: number,
    ): BlackboardConvergenceResult {
        const currentSteps = turn.steps.filter((step: BlackboardStep) => step.round === round);
        if (currentSteps.length < expectedWorkerCount) {
            return { status: "continue", reason: BlackboardConvergenceReason.WaitingForWorkers };
        }

        const openIssues = this.normalizedUnique([
            ...currentSteps.flatMap((step: BlackboardStep) => this.readMetadataStringArray(step.metadata.qaOpenIssues)),
            ...currentSteps.flatMap((step: BlackboardStep) => step.blockers),
        ]);
        const agreements = currentSteps.map((step: BlackboardStep) => this.readMetadataBoolean(step.metadata.qaAgreement));
        const hasExplicitRejection = agreements.some((agreement: boolean | undefined) => agreement === false);
        const outcomes = currentSteps.map((step: BlackboardStep) => this.readMetadataWorkerOutcome(step.metadata.qaOutcome));
        const hasFinalOutputs =
            outcomes.length === expectedWorkerCount &&
            outcomes.every((outcome: BlackboardWorkerOutcome | undefined) => outcome === BlackboardWorkerOutcome.Final);
        const hasBlockedOutputs =
            outcomes.length === expectedWorkerCount &&
            outcomes.every((outcome: BlackboardWorkerOutcome | undefined) => outcome === BlackboardWorkerOutcome.Blocked);
        if (hasFinalOutputs && !hasExplicitRejection && openIssues.length === 0) {
            return { status: BlackboardTurnStatus.Converged, reason: BlackboardConvergenceReason.WorkersReachedConsensus };
        }
        if (hasBlockedOutputs && openIssues.length > 0) {
            return { status: BlackboardTurnStatus.NeedsUser, reason: BlackboardConvergenceReason.PeerQaOpenIssues };
        }

        if (openIssues.length > 0) {
            return { status: "continue", reason: BlackboardConvergenceReason.PeerQaOpenIssues };
        }
        if (!hasFinalOutputs) {
            return { status: "continue", reason: BlackboardConvergenceReason.AwaitingWorkerFinalOutput };
        }
        if (hasExplicitRejection) {
            return { status: "continue", reason: BlackboardConvergenceReason.AwaitingWorkerConsensus };
        }

        return { status: "continue", reason: BlackboardConvergenceReason.AwaitingWorkerConsensus };
    }

    public latestUnresolvedIssues(turn: BlackboardTurn, reason: string): string[] {
        const latestRound = turn.steps.reduce((highest: number, step: BlackboardStep) => Math.max(highest, step.round), 0);
        const useFullTurn = reason === BlackboardConvergenceReason.HardRoundBudgetExhausted;
        const sourceSteps = useFullTurn ? turn.steps : turn.steps.filter((step: BlackboardStep) => step.round === latestRound);
        const contract = this.blackboardContractFor(turn);
        const issues = this.normalizedUnique([
            ...sourceSteps.flatMap((step: BlackboardStep) => step.blockers),
            ...sourceSteps.flatMap((step: BlackboardStep) => this.readMetadataStringArray(step.metadata.qaOpenIssues)),
            ...sourceSteps.flatMap((step: BlackboardStep) => this.readMetadataStringArray(step.metadata.qaQuestions)),
            ...contract.contradictions.map((item) => `${item.left} / ${item.right}: ${item.reason}`),
        ]);
        if (issues.length > 0) {
            return issues.slice(0, MAX_UNRESOLVED_ISSUES);
        }
        if (reason === BlackboardConvergenceReason.AwaitingWorkerFinalOutput) {
            return [
                "Confirm whether the board should continue even though workers did not return a structured final outcome.",
            ];
        }
        if (reason === BlackboardConvergenceReason.AwaitingWorkerConsensus) {
            return [
                "Confirm which remaining disagreement should decide the next round because workers did not return structured agreement.",
            ];
        }
        return [
            "Confirm whether to narrow the task, accept the remaining risk, or provide new facts because the board reached its discussion limit without structured convergence.",
        ];
    }

    public appendStepToTurn(turn: BlackboardTurn, step: BlackboardStep): BlackboardTurn {
        return { ...turn, steps: [...turn.steps, step] };
    }

    protected dedupeWorkers(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
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

    protected sortWorkersByDependencies(workers: BlackboardWorkerPlanInput[]): BlackboardWorkerPlanInput[] {
        const pending = new Map(workers.map((worker) => [worker.role, worker]));
        const emitted = new Set<string>();
        const sorted: BlackboardWorkerPlanInput[] = [];

        while (pending.size > 0) {
            const ready = [...pending.values()].find((worker: BlackboardWorkerPlanInput) =>
                (worker.dependsOn ?? []).every((dependency: string) => emitted.has(dependency)),
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

    protected workerPhase(turn: BlackboardTurn, worker: BlackboardWorkerState, round: number, minRounds: number): string {
        if (round < minRounds) {
            return "explore-and-question";
        }
        if (round === 1) {
            return worker.dependsOn.length > 0 ? "respond-to-upstream-and-propose" : "decompose-and-propose";
        }
        const priorOpenIssues = turn.steps
            .filter((step: BlackboardStep) => step.round < round)
            .flatMap((step: BlackboardStep) => this.readMetadataStringArray(step.metadata.qaOpenIssues));
        return priorOpenIssues.length > 0 ? "answer-open-issues-and-converge" : "converge-or-defer";
    }

    protected summarizeObjective(goal: string): string {
        const firstLine = goal
            .split(/\n+/u)
            .map((line) => line.trim())
            .find(Boolean);
        const summary = firstLine ?? goal.trim();
        return summary.length <= MAX_OBJECTIVE_LENGTH ? summary : `${summary.slice(0, MAX_OBJECTIVE_LENGTH)}...`;
    }

    protected readMetadataBoolean(value: unknown): boolean | undefined {
        return typeof value === "boolean" ? value : undefined;
    }

    public stringMetadata(value: unknown): string | undefined {
        return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }

    protected readMetadataStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.filter((item): item is string => typeof item === "string");
    }

    protected readMetadataWorkerOutcome(value: unknown): BlackboardWorkerOutcome | undefined {
        if (
            value === BlackboardWorkerOutcome.Blocked ||
            value === BlackboardWorkerOutcome.Continue ||
            value === BlackboardWorkerOutcome.Final
        ) {
            return value;
        }
        return undefined;
    }

    protected normalizedUnique(values: string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const value of values) {
            const normalized = this.normalizeText(value);
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            result.push(value.trim());
        }
        return result;
    }

    protected normalizeText(value: string): string {
        return value.trim().toLowerCase().replace(/\s+/gu, " ");
    }

    protected isBlackboardPlan(value: unknown): value is BlackboardDiscussionPlan {
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

    protected isBlackboardContract(value: unknown): value is BlackboardContract {
        if (!value || typeof value !== "object") {
            return false;
        }
        const candidate = value as Partial<BlackboardContract>;
        return candidate.mode === "normal" || candidate.mode === "non-convergent";
    }

    protected normalBlackboardContract(): BlackboardContract {
        return {
            contradictions: [],
            evidence: [],
            mode: "normal",
            policyReason: DEFAULT_POLICY_REASON,
        };
    }
}

export const blackboardComposition = new BlackboardComposition();

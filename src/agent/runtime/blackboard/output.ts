/**
 * Blackboard output adapters for runtime prompt, final reply, history replays,
 * and Ask handoff.
 *
 * RuntimeModule should orchestrate turns; this file owns the text/metadata
 * projections consumed by TUI, channel replies, memory replay and prompt
 * context. It only reads structured blackboard records.
 */

import type { AgentAsk, ReplayRecord } from "../../../protocol/contracts/index.ts";
import {
    AskReason,
    BlackboardMode,
    BlackboardTurnStatus,
    ReplayRecordKind,
    type BlackboardTurnStatus as BlackboardTurnStatusType,
} from "../../../protocol/contracts/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";
import { renderBlackboardAdvisoryPrompt } from "../../prompts/index.ts";
import type { BlackboardDecision, BlackboardMessage, BlackboardStep, BlackboardTurn } from "../../blackboard/index.ts";
import type { RuntimeBlackboardRouteDecision } from "./route.ts";

export interface RuntimeBlackboardRun {
    elapsedMs: number;
    mode: BlackboardMode;
    reason: string;
    decisions: BlackboardDecision[];
    metadata: Record<string, unknown>;
    steps: BlackboardTurn["steps"];
    status?: BlackboardTurnStatusType;
    transcript: BlackboardMessage[];
    turnId?: string;
}

@Component()
export class RuntimeBlackboardOutputComponent extends Runtime {
    public blackboardRunFromTurn(
        turn: BlackboardTurn | undefined,
        elapsedMs: number,
        route: RuntimeBlackboardRouteDecision,
    ): RuntimeBlackboardRun {
        return {
            elapsedMs,
            mode: BlackboardMode.Blackboard,
            reason: route.reason,
            decisions: turn?.decisions ?? [],
            metadata: {
                ...(turn?.metadata ?? {}),
                ...this.routeMetadata(route),
            },
            steps: turn?.steps ?? [],
            status: turn?.status,
            transcript: turn?.messages ?? [],
            turnId: turn?.id,
        };
    }

    public renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
        if (!run) {
            return renderBlackboardAdvisoryPrompt({ configured: false });
        }
        if (run.mode !== BlackboardMode.Blackboard) {
            return renderBlackboardAdvisoryPrompt({ configured: true, mode: "direct", reason: run.reason });
        }
        return renderBlackboardAdvisoryPrompt({
            compactRounds: this.renderBlackboardTranscript(run),
            configured: true,
            elapsedMs: run.elapsedMs,
            mode: run.mode,
            reason: run.reason,
            status: run.status,
            turnId: run.turnId,
        });
    }

    public renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
        return `${this.renderReplyPrefix(run)}${finalAnswer}`;
    }

    public renderReplyPrefix(run: RuntimeBlackboardRun | undefined): string {
        if (!run || run.mode !== BlackboardMode.Blackboard) {
            return "";
        }
        return [...this.renderBlackboardTranscript(run), ...this.renderDecisionLines(run), "", "Final answer:", ""].join("\n");
    }

    public renderReplyStreamingPrefix(run: RuntimeBlackboardRun | undefined): string {
        if (!run || run.mode !== BlackboardMode.Blackboard) {
            return "";
        }
        const decisionLines = this.renderDecisionLines(run);
        if (decisionLines.length > 0) {
            return [...decisionLines, "", "Final answer:", ""].join("\n");
        }
        return "\n---\n\n";
    }

    public routeMetadata(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
        return {
            route: {
                mode: route.mode,
                needsReflectionCandidate: route.needsReflectionCandidate,
                raw: route.raw,
                reason: route.reason,
                score: route.score,
                signals: route.signals,
            },
        };
    }

    public buildBlackboardReplayRecords(
        ownerKey: string,
        auditUserId: string | undefined,
        now: string,
        run: RuntimeBlackboardRun | undefined,
        requestId: string,
    ): ReplayRecord[] {
        if (!run || run.mode !== BlackboardMode.Blackboard || !run.turnId) return [];
        const facts = this.uniqueStrings(run.steps.flatMap((step) => step.newFacts)).slice(0, 16);
        const openQuestions = this.uniqueStrings([
            ...run.decisions.map((decision) => decision.prompt),
            ...run.steps.flatMap((step) => step.blockers),
        ]).slice(0, 12);
        return [
            {
                id: `replay-blackboard-${run.turnId}`,
                ownerKey,
                auditUserId,
                userId: auditUserId,
                kind: ReplayRecordKind.Blackboard,
                title: `Blackboard ${run.status ?? BlackboardTurnStatus.Running}`,
                summary: `status=${run.status ?? BlackboardTurnStatus.Running}; reason=${run.reason}; steps=${run.steps.length}; decisions=${run.decisions.length}`,
                detail: this.renderBlackboardReplayDetail(run),
                visibleFacts: facts,
                openQuestions,
                blackboardTurnId: run.turnId,
                createdAt: this.normalizeIso(now),
                updatedAt: this.normalizeIso(now),
            },
        ];
    }

    /**
     * LF-R3 slice D：把黑板封顶（NeedsUser）状态合成为 AgentAsk(reason=blackboard-stalemate)。
     * 仅消费 blackboard.status + 最新 decision（结构化资源指标），不做任何文本启发。
     * 模型本轮已显式 ask 时不调用本函数（model-ask 优先）。
     */
    public buildBlackboardStalemateAsk(run: RuntimeBlackboardRun | undefined): AgentAsk | undefined {
        if (!run || run.status !== BlackboardTurnStatus.NeedsUser) return undefined;
        const decision = run.decisions[run.decisions.length - 1];
        if (!decision) return undefined;
        const choices = decision.options.map((option) => ({
            value: option.id,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
        }));
        return {
            reason: AskReason.BlackboardStalemate,
            prompt: decision.prompt,
            ...(choices.length > 0 ? { choices } : {}),
            freeform: true,
            rationale: `blackboard:${decision.reason}`,
        };
    }

    /**
     * 把黑板辩论转写为 episode text：用户问题 + 每个 worker 的 outputSummary，
     * 截断保护，便于长期检索而不存原始长 transcript。
     */
    public renderDebateEpisodeText(userText: string, run: RuntimeBlackboardRun): string {
        const head = `[debate-goal] ${userText.slice(0, 256)}`;
        const summaries = run.steps
            .map((step) => {
                const summary = step.outputSummary ?? "";
                if (!summary) return "";
                return `[${step.workerRole}] ${summary.slice(0, 256)}`;
            })
            .filter((s) => s.length > 0)
            .join("\n");
        return summaries ? `${head}\n${summaries}` : head;
    }

    private renderBlackboardReplayDetail(run: RuntimeBlackboardRun): string {
        const lines = [
            `Route: ${run.reason}`,
            `Status: ${run.status ?? BlackboardTurnStatus.Running}`,
            `Plan: ${this.planSummaryForRun(run)}`,
        ];
        for (const step of run.steps.slice(0, 12)) {
            lines.push(`r${step.round} ${step.workerRole}: ${this.compactDialogueText(step.outputSummary)}`);
        }
        for (const decision of run.decisions.slice(-3)) {
            lines.push(`decision: ${this.compactDialogueText(decision.prompt)}`);
        }
        return lines.join("\n").slice(0, 4000);
    }

    private normalizeIso(value: string): string {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
    }

    private uniqueStrings(values: string[]): string[] {
        return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    }

    private renderBlackboardTranscript(run: RuntimeBlackboardRun): string[] {
        const rounds = [
            ...new Set([
                ...run.steps.map((step) => step.round),
                ...run.transcript
                    .map((message) => message.round)
                    .filter((round): round is number => typeof round === "number"),
            ]),
        ]
            .filter((round) => round > 0)
            .sort((left, right) => left - right);
        const header = [
            "",
            "Blackboard discussion:",
            `Status: ${run.status ?? BlackboardTurnStatus.Running}; reason: ${run.reason}; plan: ${this.planSummaryForRun(run)}`,
        ];
        if (rounds.length === 0) {
            return [...header, "Blackboard: No worker discussion was recorded."];
        }
        return [...header, ...rounds.flatMap((round) => this.renderRoundDialogue(run, round))];
    }

    private renderRoundDialogue(run: RuntimeBlackboardRun, round: number): string[] {
        const steps = run.steps.filter((step) => step.round === round);
        const messages = run.transcript.filter((message) => message.round === round && message.visibility === "public");
        const dialogue = messages.length > 0 ? messages.map((message) => this.renderDialogueMessage(run, message)) : [];
        const fallback = dialogue.length > 0 ? [] : steps.map((step) => this.renderStepAsDialogue(run, step));
        return [
            "",
            `Round ${round} (${this.phaseForRound(run, round, this.policyReasonForRound(run, round))})`,
            ...dialogue,
            ...fallback,
        ];
    }

    private renderDialogueMessage(run: RuntimeBlackboardRun, message: BlackboardMessage): string {
        const speaker = message.workerRole
            ? this.displayNameForWorker(run, message.workerRole)
            : this.readableMessageRole(message.role);
        return `${speaker}: ${this.compactDialogueText(message.content)}`;
    }

    private renderStepAsDialogue(run: RuntimeBlackboardRun, step: BlackboardStep): string {
        return `${this.displayNameForWorker(run, step.workerRole)}: ${this.compactStepOutput(step)}`;
    }

    private compactDialogueText(value: string): string {
        return value.replace(/\s+/gu, " ").trim();
    }

    private phaseForRound(run: RuntimeBlackboardRun, round: number, policy: string): string {
        if (policy === "declared-non-convergent-contract" && round > 1) {
            return "reframe";
        }
        if (round <= 1) {
            return "decompose";
        }
        return run.status === BlackboardTurnStatus.Converged && round === this.latestRound(run) ? "final-output" : "qa";
    }

    private policyReasonForRound(run: RuntimeBlackboardRun, round: number): string {
        const step = run.steps.find((item) => item.round === round);
        const policy = step?.metadata.convergencePolicy;
        if (this.isPolicyMetadata(policy)) {
            return policy.reason;
        }
        return "default-convergence";
    }

    private isPolicyMetadata(value: unknown): value is { forceHardCap: boolean; reason: string } {
        if (!value || typeof value !== "object") {
            return false;
        }
        const candidate = value as { reason?: unknown };
        return typeof candidate.reason === "string";
    }

    private compactStepOutput(step: BlackboardStep): string {
        const questions = this.readStringArray(step.metadata.qaQuestions);
        const answers = this.readStringArray(step.metadata.qaAnswers);
        const openIssues = this.readStringArray(step.metadata.qaOpenIssues);
        const agreement = this.readBoolean(step.metadata.qaAgreement);
        const outcome = typeof step.metadata.qaOutcome === "string" ? step.metadata.qaOutcome : undefined;
        const qa = [
            questions.length > 0 ? `Q=${questions.join("; ")}` : "",
            answers.length > 0 ? `A=${answers.join("; ")}` : "",
            outcome ? `outcome=${outcome}` : "",
            agreement !== undefined ? `agreement=${agreement ? "yes" : "no"}` : "",
            openIssues.length > 0 ? `open=${openIssues.join("; ")}` : "",
        ].filter(Boolean);
        const blockers = step.blockers.length > 0 ? `; blockers=${step.blockers.join("; ")}` : "";
        return `${step.outputSummary}${qa.length > 0 ? `; QA: ${qa.join("; ")}` : ""}${blockers}`;
    }

    private readableWorkerRole(role: string): string {
        return role
            .split(/[-_.]+/u)
            .filter(Boolean)
            .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
            .join(" ");
    }

    private latestRound(run: RuntimeBlackboardRun): number {
        return run.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
    }

    private renderDecisionLines(run: RuntimeBlackboardRun): string[] {
        if (run.decisions.length === 0) {
            return [];
        }
        return run.decisions.map(
            (decision) => `Blackboard needs input: ${decision.reason}; ${decision.prompt.replace(/\s+/gu, " ")}`,
        );
    }

    private planSummaryForRun(run: RuntimeBlackboardRun): string {
        const plan = run.metadata.blackboardPlan;
        if (!plan || typeof plan !== "object") {
            return "-";
        }
        const workstreams = (plan as { workstreams?: unknown }).workstreams;
        if (!Array.isArray(workstreams) || workstreams.length === 0) {
            return "-";
        }
        return workstreams
            .filter((item): item is string => typeof item === "string")
            .slice(0, 2)
            .join(" / ");
    }

    private displayNameForWorker(run: RuntimeBlackboardRun, role: string): string {
        const plan = run.metadata.blackboardPlan;
        if (plan && typeof plan === "object") {
            const participants = (plan as { participants?: unknown }).participants;
            if (Array.isArray(participants)) {
                const participant = participants.find(
                    (item): item is { name?: unknown; role?: unknown } =>
                        !!item && typeof item === "object" && (item as { role?: unknown }).role === role,
                );
                if (typeof participant?.name === "string" && participant.name.trim()) {
                    return participant.name.trim();
                }
            }
        }
        return this.readableWorkerRole(role);
    }

    private readableMessageRole(role: BlackboardMessage["role"]): string {
        if (role === "system") {
            return "Blackboard";
        }
        return this.readableWorkerRole(role);
    }

    private readStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.filter((item): item is string => typeof item === "string");
    }

    private readBoolean(value: unknown): boolean | undefined {
        return typeof value === "boolean" ? value : undefined;
    }
}

const defaultOutput = new RuntimeBlackboardOutputComponent();

export function blackboardRunFromTurn(
    turn: BlackboardTurn | undefined,
    elapsedMs: number,
    route: RuntimeBlackboardRouteDecision,
): RuntimeBlackboardRun {
    return defaultOutput.blackboardRunFromTurn(turn, elapsedMs, route);
}

export function renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
    return defaultOutput.renderBlackboardPrompt(run);
}

export function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    return defaultOutput.renderReplyText(finalAnswer, run);
}

export function renderReplyPrefix(run: RuntimeBlackboardRun | undefined): string {
    return defaultOutput.renderReplyPrefix(run);
}

export function renderReplyStreamingPrefix(run: RuntimeBlackboardRun | undefined): string {
    return defaultOutput.renderReplyStreamingPrefix(run);
}

export function routeMetadata(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
    return defaultOutput.routeMetadata(route);
}

export function buildBlackboardReplayRecords(
    ownerKey: string,
    auditUserId: string | undefined,
    now: string,
    run: RuntimeBlackboardRun | undefined,
    requestId: string,
): ReplayRecord[] {
    return defaultOutput.buildBlackboardReplayRecords(ownerKey, auditUserId, now, run, requestId);
}

export function buildBlackboardStalemateAsk(run: RuntimeBlackboardRun | undefined): AgentAsk | undefined {
    return defaultOutput.buildBlackboardStalemateAsk(run);
}

export function renderDebateEpisodeText(userText: string, run: RuntimeBlackboardRun): string {
    return defaultOutput.renderDebateEpisodeText(userText, run);
}

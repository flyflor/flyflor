/**
 * Blackboard output adapters for runtime prompt, final reply, history scenes,
 * and Ask handoff.
 *
 * RuntimeModule should orchestrate turns; this file owns the text/metadata
 * projections consumed by TUI, channel replies, memory scene replay and prompt
 * context. It only reads structured blackboard records.
 */

import type { AgentAsk, SceneRecord } from "../../../protocol/contracts/index.ts";
import {
    AskReason,
    BlackboardMode,
    BlackboardTurnStatus,
    SceneRecordKind,
    type BlackboardTurnStatus as BlackboardTurnStatusType,
} from "../../../protocol/contracts/index.ts";
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

export function blackboardRunFromTurn(
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
            ...routeMetadata(route),
        },
        steps: turn?.steps ?? [],
        status: turn?.status,
        transcript: turn?.messages ?? [],
        turnId: turn?.id,
    };
}

export function renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
    if (!run) {
        return renderBlackboardAdvisoryPrompt({ configured: false });
    }
    if (run.mode !== BlackboardMode.Blackboard) {
        return renderBlackboardAdvisoryPrompt({ configured: true, mode: "direct", reason: run.reason });
    }
    return renderBlackboardAdvisoryPrompt({
        compactRounds: renderBlackboardTranscript(run),
        configured: true,
        elapsedMs: run.elapsedMs,
        mode: run.mode,
        reason: run.reason,
        status: run.status,
        turnId: run.turnId,
    });
}

export function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    return `${renderReplyPrefix(run)}${finalAnswer}`;
}

export function renderReplyPrefix(run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode !== BlackboardMode.Blackboard) {
        return "";
    }
    return [...renderBlackboardTranscript(run), ...renderDecisionLines(run), "", "Final answer:", ""].join("\n");
}

export function renderReplyStreamingPrefix(run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode !== BlackboardMode.Blackboard) {
        return "";
    }
    const decisionLines = renderDecisionLines(run);
    if (decisionLines.length > 0) {
        return [...decisionLines, "", "Final answer:", ""].join("\n");
    }
    return "\n---\n\n";
}

export function routeMetadata(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
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

export function buildBlackboardSceneRecords(
    userId: string,
    now: string,
    run: RuntimeBlackboardRun | undefined,
    requestId: string,
): SceneRecord[] {
    if (!run || run.mode !== BlackboardMode.Blackboard || !run.turnId) return [];
    const facts = uniqueStrings(run.steps.flatMap((step) => step.newFacts)).slice(0, 16);
    const openQuestions = uniqueStrings([
        ...run.decisions.map((decision) => decision.prompt),
        ...run.steps.flatMap((step) => step.blockers),
    ]).slice(0, 12);
    return [
        {
            id: `scene-blackboard-${run.turnId}`,
            userId,
            kind: SceneRecordKind.Blackboard,
            title: `Blackboard ${run.status ?? BlackboardTurnStatus.Running}`,
            summary: `status=${run.status ?? BlackboardTurnStatus.Running}; reason=${run.reason}; steps=${run.steps.length}; decisions=${run.decisions.length}`,
            detail: renderBlackboardSceneDetail(run),
            visibleFacts: facts,
            openQuestions,
            blackboardTurnId: run.turnId,
            createdAt: normalizeIso(now),
            updatedAt: normalizeIso(now),
        },
    ];
}

/**
 * LF-R3 slice D：把黑板封顶（NeedsUser）状态合成为 AgentAsk(reason=blackboard-stalemate)。
 * 仅消费 blackboard.status + 最新 decision（结构化资源指标），不做任何文本启发。
 * 模型本轮已显式 ask 时不调用本函数（model-ask 优先）。
 */
export function buildBlackboardStalemateAsk(run: RuntimeBlackboardRun | undefined): AgentAsk | undefined {
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
export function renderDebateEpisodeText(userText: string, run: RuntimeBlackboardRun): string {
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

function renderBlackboardSceneDetail(run: RuntimeBlackboardRun): string {
    const lines = [
        `Route: ${run.reason}`,
        `Status: ${run.status ?? BlackboardTurnStatus.Running}`,
        `Plan: ${planSummaryForRun(run)}`,
    ];
    for (const step of run.steps.slice(0, 12)) {
        lines.push(`r${step.round} ${step.workerRole}: ${compactDialogueText(step.outputSummary)}`);
    }
    for (const decision of run.decisions.slice(-3)) {
        lines.push(`decision: ${compactDialogueText(decision.prompt)}`);
    }
    return lines.join("\n").slice(0, 4000);
}

function normalizeIso(value: string): string {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function renderBlackboardTranscript(run: RuntimeBlackboardRun): string[] {
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
        `Status: ${run.status ?? BlackboardTurnStatus.Running}; reason: ${run.reason}; plan: ${planSummaryForRun(run)}`,
    ];
    if (rounds.length === 0) {
        return [...header, "Blackboard: No worker discussion was recorded."];
    }
    return [...header, ...rounds.flatMap((round) => renderRoundDialogue(run, round))];
}

function renderRoundDialogue(run: RuntimeBlackboardRun, round: number): string[] {
    const steps = run.steps.filter((step) => step.round === round);
    const messages = run.transcript.filter((message) => message.round === round && message.visibility === "public");
    const dialogue = messages.length > 0 ? messages.map((message) => renderDialogueMessage(run, message)) : [];
    const fallback = dialogue.length > 0 ? [] : steps.map((step) => renderStepAsDialogue(run, step));
    return [
        "",
        `Round ${round} (${phaseForRound(run, round, policyReasonForRound(run, round))})`,
        ...dialogue,
        ...fallback,
    ];
}

function renderDialogueMessage(run: RuntimeBlackboardRun, message: BlackboardMessage): string {
    const speaker = message.workerRole
        ? displayNameForWorker(run, message.workerRole)
        : readableMessageRole(message.role);
    return `${speaker}: ${compactDialogueText(message.content)}`;
}

function renderStepAsDialogue(run: RuntimeBlackboardRun, step: BlackboardStep): string {
    return `${displayNameForWorker(run, step.workerRole)}: ${compactStepOutput(step)}`;
}

function compactDialogueText(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}

function phaseForRound(run: RuntimeBlackboardRun, round: number, policy: string): string {
    if (policy === "declared-non-convergent-contract" && round > 1) {
        return "reframe";
    }
    if (round <= 1) {
        return "decompose";
    }
    return run.status === BlackboardTurnStatus.Converged && round === latestRound(run) ? "final-output" : "qa";
}

function policyReasonForRound(run: RuntimeBlackboardRun, round: number): string {
    const step = run.steps.find((item) => item.round === round);
    const policy = step?.metadata.convergencePolicy;
    if (isPolicyMetadata(policy)) {
        return policy.reason;
    }
    return "default-convergence";
}

function isPolicyMetadata(value: unknown): value is { forceHardCap: boolean; reason: string } {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as { reason?: unknown };
    return typeof candidate.reason === "string";
}

function compactStepOutput(step: BlackboardStep): string {
    const questions = readStringArray(step.metadata.qaQuestions);
    const answers = readStringArray(step.metadata.qaAnswers);
    const openIssues = readStringArray(step.metadata.qaOpenIssues);
    const agreement = readBoolean(step.metadata.qaAgreement);
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

function readableWorkerRole(role: string): string {
    return role
        .split(/[-_.]+/u)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

function latestRound(run: RuntimeBlackboardRun): number {
    return run.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
}

function renderDecisionLines(run: RuntimeBlackboardRun): string[] {
    if (run.decisions.length === 0) {
        return [];
    }
    return run.decisions.map(
        (decision) => `Blackboard needs input: ${decision.reason}; ${decision.prompt.replace(/\s+/gu, " ")}`,
    );
}

function planSummaryForRun(run: RuntimeBlackboardRun): string {
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

function displayNameForWorker(run: RuntimeBlackboardRun, role: string): string {
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
    return readableWorkerRole(role);
}

function readableMessageRole(role: BlackboardMessage["role"]): string {
    if (role === "system") {
        return "Blackboard";
    }
    return readableWorkerRole(role);
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

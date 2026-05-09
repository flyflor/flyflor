import type { FlyflorConfig } from "../../config/index.ts";
import type {
    BlackboardTurnStatus as BlackboardTurnStatusType,
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    RuntimeContext,
} from "../../fpc/contracts/index.ts";
import { BlackboardTurnStatus, ModelRole } from "../../fpc/contracts/index.ts";
import { Runtime as RuntimeComponent } from "../../fpc/decorators/index.ts";
import { event, FpcEventType, type EventSink } from "../../fpc/events/index.ts";
import { createMemory, type AgentMemory } from "../memory/index.ts";
import { parseMemoryActions, renderMemoryActionPrompt } from "../memory/actions.ts";
import { loadMcpServers, renderMcpPrompt } from "../../core/mcp/index.ts";
import { createSandboxPolicy } from "../sandbox/index.ts";
import {
    type BlackboardController,
    type BlackboardDecision,
    type BlackboardMessage,
    type BlackboardStep,
    type BlackboardTurn,
} from "../blackboard/index.ts";
import { scopeFor } from "../session/index.ts";
import { loadSkills, renderSkillPrompt, selectSkills } from "../../core/skills/index.ts";

export { startHumanChat } from "./chat.ts";

interface RuntimeBlackboardRun {
    elapsedMs: number;
    mode: "blackboard" | "direct";
    reason: string;
    decisions: BlackboardDecision[];
    metadata: Record<string, unknown>;
    steps: BlackboardTurn["steps"];
    status?: BlackboardTurnStatusType;
    transcript: BlackboardMessage[];
    turnId?: string;
}

@RuntimeComponent()
export class AgentRuntime {
    private readonly memory: AgentMemory;

    constructor(
        private readonly config: FlyflorConfig,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        private readonly blackboard?: BlackboardController,
    ) {
        this.memory = createMemory(config, events);
    }

    async handleMessage(message: GatewayMessage, context: RuntimeContext): Promise<GatewayReply> {
        this.events.publish(event(FpcEventType.AgentTurnStart, { channel: message.route.channel }, context.requestId));

        const [skills, mcpServers, memoryPrompt] = await Promise.all([
            loadSkills(this.config.paths),
            loadMcpServers(this.config.paths),
            this.memory.buildPrompt(message),
        ]);
        const selectedSkills = selectSkills(skills, message.text);
        const sandbox = createSandboxPolicy(this.config.sandbox);
        const blackboardRun = await this.runBlackboard(message, context);

        const modelMessages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: [
                    "You are Flyflor, an agent runtime connected through a multi-channel gateway.",
                    "Answer the user directly. Do not claim to have executed tools unless a tool result is present.",
                    `Sandbox policy: ${sandbox.summary}`,
                    renderMemoryActionPrompt(),
                    "Memory context:",
                    memoryPrompt,
                    "Loaded skills:",
                    renderSkillPrompt(selectedSkills),
                    "Configured MCP servers:",
                    renderMcpPrompt(mcpServers),
                    "Blackboard discussion:",
                    renderBlackboardPrompt(blackboardRun),
                ].join("\n\n"),
            },
            {
                role: ModelRole.User,
                content: message.text,
            },
        ];

        const rawText = await this.model.generate(modelMessages);
        const parsed = parseMemoryActions(rawText, this.config.memory.candidates.maxCandidatesPerTurn);
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: renderReplyText(parsed.text || rawText, blackboardRun),
            metadata: {
                blackboard: blackboardRun
                    ? {
                          elapsedMs: blackboardRun.elapsedMs,
                          messages: blackboardRun.transcript.length,
                          mode: blackboardRun.mode,
                          reason: blackboardRun.reason,
                          status: blackboardRun.status,
                          turnId: blackboardRun.turnId,
                      }
                    : {
                          mode: "direct",
                          reason: "blackboard-controller-not-configured",
                      },
                memoryActions: parsed.actions.length,
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                sandboxMode: sandbox.mode,
                skills: selectedSkills.map((skill) => skill.name),
            },
        };
        await this.memory.rememberTurn(message, reply, context, parsed.actions);
        this.events.publish(event(FpcEventType.AgentTurnEnd, { channel: message.route.channel }, context.requestId));

        return reply;
    }

    private async runBlackboard(
        message: GatewayMessage,
        context: RuntimeContext,
    ): Promise<RuntimeBlackboardRun | undefined> {
        if (!this.blackboard) {
            return undefined;
        }

        const route = selectBlackboardRoute(message.text);
        const started = performance.now();
        const start = await this.blackboard.startTurn({
            sessionKey: scopeFor(message),
            requestId: context.requestId,
            goal: message.text,
            now: context.now,
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
            },
            metadata: {
                routeReason: route.reason,
                runtime: "agent-runtime",
            },
        });
        if (!start.acquired) {
            return {
                elapsedMs: elapsed(started),
                mode: "blackboard",
                reason: "session-lease-conflict",
                decisions: [],
                metadata: {},
                steps: [],
                status: BlackboardTurnStatus.Running,
                transcript: [
                    {
                        id: crypto.randomUUID(),
                        turnId: start.conflict.turnId,
                        role: "system",
                        content: `当前 session 已有黑板 turn 正在运行：${start.conflict.turnId}`,
                        visibility: "public",
                        createdAt: context.now,
                        metadata: {
                            conflictExpiresAt: start.conflict.expiresAt,
                        },
                    },
                ],
                turnId: start.conflict.turnId,
            };
        }

        try {
            const finished = await this.blackboard.runUntilConverged(start.turn.id, { createdAt: context.now });
            return blackboardRunFromTurn(
                finished ?? (await this.blackboard.getTurn(start.turn.id)),
                started,
                route.reason,
            );
        } catch (error) {
            await this.blackboard.finishTurn(start.turn.id, BlackboardTurnStatus.Failed, context.now);
            const loaded = await this.blackboard.getTurn(start.turn.id);
            const messageText = error instanceof Error ? error.message : String(error);
            return {
                elapsedMs: elapsed(started),
                mode: "blackboard",
                reason: "blackboard-worker-failed",
                decisions: loaded?.decisions ?? [],
                metadata: loaded?.metadata ?? {},
                steps: loaded?.steps ?? [],
                status: BlackboardTurnStatus.Failed,
                transcript: [
                    ...(loaded?.messages ?? []),
                    {
                        id: crypto.randomUUID(),
                        turnId: start.turn.id,
                        role: "system",
                        content: `黑板 worker 执行失败：${messageText}`,
                        visibility: "public",
                        createdAt: context.now,
                        metadata: {},
                    },
                ],
                turnId: start.turn.id,
            };
        }
    }
}

function selectBlackboardRoute(_text: string): { mode: "blackboard"; reason: string } {
    return { mode: "blackboard", reason: "default-blackboard" };
}

function blackboardRunFromTurn(
    turn: BlackboardTurn | undefined,
    started: number,
    reason: string,
): RuntimeBlackboardRun {
    return {
        elapsedMs: elapsed(started),
        mode: "blackboard",
        reason,
        decisions: turn?.decisions ?? [],
        metadata: turn?.metadata ?? {},
        steps: turn?.steps ?? [],
        status: turn?.status,
        transcript: turn?.messages ?? [],
        turnId: turn?.id,
    };
}

function renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
    if (!run) {
        return "No blackboard controller is configured for this runtime.";
    }
    if (run.mode === "direct") {
        return `Direct route selected: ${run.reason}.`;
    }
    return [
        "Use the blackboard as advisory context. If the blackboard status is needs-user or failed, do not claim it converged.",
        `turnId=${run.turnId ?? "unknown"} status=${run.status ?? "unknown"} reason=${run.reason} elapsedMs=${run.elapsedMs}`,
        ...renderCompactRounds(run),
    ].join("\n");
}

function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode === "direct") {
        return finalAnswer;
    }
    return [...renderCompactRounds(run), ...renderDecisionLines(run), "", "最终回答：", finalAnswer].join("\n");
}

function renderCompactRounds(run: RuntimeBlackboardRun): string[] {
    const rounds = [...new Set(run.steps.map((step) => step.round))]
        .filter((round) => round > 0)
        .sort((left, right) => left - right);
    return rounds.flatMap((round) => renderRoundBlock(run, round));
}

function renderRoundBlock(run: RuntimeBlackboardRun, round: number): string[] {
    const steps = run.steps.filter((step) => step.round === round);
    const planner = steps.find((step) => isPlannerStep(step));
    const reviewer = steps.find((step) => isReviewerStep(step));
    const others = steps.filter((step) => step !== planner && step !== reviewer);
    return [
        "",
        `--------------${round}--------------------`,
        `黑板：${renderBlackboardState(run, round)}`,
        `Planner：${planner ? compactStepOutput(planner) : "-"}`,
        `Reviewer：${reviewer ? compactStepOutput(reviewer) : "-"}`,
        ...others.map((step) => `${readableWorkerRole(step.workerRole)}：${compactStepOutput(step)}`),
        "-----------------------------------",
    ];
}

function renderBlackboardState(run: RuntimeBlackboardRun, round: number): string {
    const policy = policyReasonForRound(run, round);
    const phase = phaseForRound(run, round, policy);
    const plan = planSummaryForRun(run);
    const status =
        round < latestRound(run) ? BlackboardTurnStatus.Running : (run.status ?? BlackboardTurnStatus.Running);
    if (policy === "declared-non-convergent-contract" && status === BlackboardTurnStatus.Running && round > 1) {
        return `phase=${phase}；plan=${plan}；policy=${policy}；仍存在不可满足契约；继续至 hard cap`;
    }
    return `phase=${phase}；plan=${plan}；policy=${policy}；status=${status}`;
}

function phaseForRound(run: RuntimeBlackboardRun, round: number, policy: string): string {
    if (policy === "declared-non-convergent-contract" && round > 1) {
        return "重构";
    }
    if (round <= 1) {
        return "拆分";
    }
    return run.status === BlackboardTurnStatus.Converged && round === latestRound(run) ? "一致输出" : "QA";
}

function policyReasonForRound(run: RuntimeBlackboardRun, round: number): string {
    const step = run.steps.find((item) => item.round === round);
    const policy = step?.metadata.convergencePolicy;
    if (isPolicyMetadata(policy)) {
        return policy.reason;
    }
    if (run.steps.length === 0) {
        return "default-convergence";
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
    const qa = [
        questions.length > 0 ? `Q=${questions.join("；")}` : "",
        answers.length > 0 ? `A=${answers.join("；")}` : "",
        agreement !== undefined ? `一致=${agreement ? "是" : "否"}` : "",
        openIssues.length > 0 ? `open=${openIssues.join("；")}` : "",
    ].filter(Boolean);
    const blockers = step.blockers.length > 0 ? `；blockers=${step.blockers.join("；")}` : "";
    return `${step.outputSummary}${qa.length > 0 ? `；QA：${qa.join("；")}` : ""}${blockers}`;
}

function isPlannerStep(step: BlackboardStep): boolean {
    return step.workerRole.toLowerCase().includes("planner");
}

function isReviewerStep(step: BlackboardStep): boolean {
    return step.workerRole.toLowerCase().includes("reviewer");
}

function readableWorkerRole(role: string): string {
    const lower = role.toLowerCase();
    if (lower.includes("planner")) {
        return "Planner";
    }
    if (lower.includes("reviewer")) {
        return "Reviewer";
    }
    return role;
}

function latestRound(run: RuntimeBlackboardRun): number {
    return run.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
}

function renderDecisionLines(run: RuntimeBlackboardRun): string[] {
    if (run.decisions.length === 0) {
        return [];
    }
    return run.decisions.map((decision) => `黑板裁决：${decision.reason}；${decision.prompt.replace(/\s+/gu, " ")}`);
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

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function elapsed(started: number): number {
    return Number((performance.now() - started).toFixed(3));
}

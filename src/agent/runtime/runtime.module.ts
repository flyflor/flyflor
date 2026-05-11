import type { FlyflorConfig } from "../../config/index.ts";
import type {
    BlackboardTurnStatus as BlackboardTurnStatusType,
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    RuntimeContext,
} from "../../protocol/contracts/index.ts";
import {
    ArchitectureLayer,
    BlackboardMode,
    BlackboardTurnStatus,
    ComponentKind,
    ModelRole,
} from "../../protocol/contracts/index.ts";
import { Runtime as RuntimeBoundary } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { parseMemoryActions, renderMemoryActionPrompt } from "../../neural/memory/actions.ts";
import { createMemory, type MemoryModule } from "../../neural/memory/index.ts";
import { loadMcpServers } from "../mcp/index.ts";
import { createSandboxPolicy } from "../sandbox/index.ts";
import {
    loadPromptTemplates,
    renderBlackboardAdvisoryPrompt,
    renderMcpContextPrompt,
    renderRuntimeSystemPrompt,
    renderSkillContextPrompt,
} from "../prompts/index.ts";
import {
    type BlackboardModule,
    type BlackboardDecision,
    type BlackboardMessage,
    type BlackboardStep,
    type BlackboardTurn,
} from "../blackboard/index.ts";
import { scopeFor } from "../session/index.ts";
import { loadSkills, selectSkills } from "../../crystal/skills/index.ts";
import { decideBlackboardRoute, type RuntimeBlackboardRouteDecision } from "./blackboard.route.ts";
import { extractRuntimeReflectionCandidates } from "./reflection.ts";

export { startHumanChat } from "./chat.ts";

interface RuntimeBlackboardRun {
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

export interface RuntimeStreamOptions {
    onTextDelta?: (text: string) => void | Promise<void>;
}

@Module({ name: "runtime", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Runtime, layer: ArchitectureLayer.Runtime, name: "runtime", provider: true })
export class RuntimeModule extends RuntimeBoundary {
    private readonly memory: MemoryModule;

    constructor(
        private readonly config: FlyflorConfig,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        private readonly blackboard?: BlackboardModule,
    ) {
        super();
        this.memory = createMemory(config, events);
    }

    async handleMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options: RuntimeStreamOptions = {},
    ): Promise<GatewayReply> {
        this.events.publish(
            event(RuntimeEventType.AgentTurnStart, { channel: message.route.channel }, context.requestId),
        );
        await loadPromptTemplates(this.config.paths);

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
                content: renderRuntimeSystemPrompt({
                    blackboardContext: renderBlackboardPrompt(blackboardRun),
                    mcpContext: renderMcpContextPrompt({ servers: mcpServers }),
                    memoryActionInstructions: renderMemoryActionPrompt(),
                    memoryContext: memoryPrompt,
                    sandboxSummary: sandbox.summary,
                    skillContext: renderSkillContextPrompt({ skills: selectedSkills }),
                }),
            },
            {
                role: ModelRole.User,
                content: message.text,
            },
        ];

        const rawText = await this.generateModelText(modelMessages, renderReplyPrefix(blackboardRun), options);
        const parsed = parseMemoryActions(rawText, this.config.memory.candidates.maxCandidatesPerTurn);
        const visibleText = parsed.text || rawText;
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: renderReplyText(visibleText, blackboardRun),
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
        const reflectionCandidates = await this.extractReflectionCandidates(
            message,
            context,
            visibleText,
            blackboardRun,
        );
        await this.memory.rememberTurn(message, reply, context, parsed.actions, reflectionCandidates);
        this.events.publish(
            event(RuntimeEventType.AgentTurnEnd, { channel: message.route.channel }, context.requestId),
        );

        return reply;
    }

    private async generateModelText(
        messages: ModelMessage[],
        replyPrefix: string,
        options: RuntimeStreamOptions,
    ): Promise<string> {
        if (!options.onTextDelta) {
            return this.model.generate(messages);
        }

        if (!this.model.stream) {
            const rawText = await this.model.generate(messages);
            await options.onTextDelta(`${replyPrefix}${filterVisibleMemoryActionText(rawText)}`);
            return rawText;
        }

        if (replyPrefix) {
            await options.onTextDelta(replyPrefix);
        }

        let rawText = "";
        const visibility = new MemoryActionVisibilityFilter();
        try {
            for await (const chunk of this.model.stream(messages)) {
                rawText += chunk;
                const visible = visibility.push(chunk);
                if (visible) {
                    await options.onTextDelta(visible);
                }
            }
        } catch (error) {
            if (rawText) {
                throw error;
            }
            const fallback = await this.model.generate(messages);
            await options.onTextDelta(filterVisibleMemoryActionText(fallback));
            return fallback;
        }

        const tail = visibility.finish();
        if (tail) {
            await options.onTextDelta(tail);
        }
        return rawText;
    }

    private async runBlackboard(
        message: GatewayMessage,
        context: RuntimeContext,
    ): Promise<RuntimeBlackboardRun | undefined> {
        if (!this.blackboard) {
            return undefined;
        }

        const route = await decideBlackboardRoute(this.model, message.text);
        if (route.mode !== BlackboardMode.Blackboard) {
            return {
                elapsedMs: 0,
                mode: route.mode,
                reason: route.reason,
                decisions: [],
                metadata: routeMetadata(route),
                steps: [],
                transcript: [],
            };
        }

        const started = performance.now();
        const start = await this.blackboard.startTurn({
            sessionKey: scopeFor(message),
            requestId: context.requestId,
            goal: message.text,
            now: context.now,
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
                minRounds: 1,
            },
            workers: route.workers,
            metadata: {
                blackboardContract: route.blackboardContract,
                routeReason: route.reason,
                routeScore: route.score,
                routeSignals: route.signals,
                routeNeedsReflectionCandidate: route.needsReflectionCandidate,
                runtime: "agent-runtime",
            },
        });
        if (!start.acquired) {
            return {
                elapsedMs: elapsed(started),
                mode: BlackboardMode.Blackboard,
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
                        content: `A blackboard turn is already running for this session: ${start.conflict.turnId}`,
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
            return blackboardRunFromTurn(finished ?? (await this.blackboard.getTurn(start.turn.id)), started, route);
        } catch (error) {
            await this.blackboard.finishTurn(start.turn.id, BlackboardTurnStatus.Failed, context.now);
            const loaded = await this.blackboard.getTurn(start.turn.id);
            const messageText = error instanceof Error ? error.message : String(error);
            return {
                elapsedMs: elapsed(started),
                mode: BlackboardMode.Blackboard,
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
                        content: `Blackboard worker failed: ${messageText}`,
                        visibility: "public",
                        createdAt: context.now,
                        metadata: {},
                    },
                ],
                turnId: start.turn.id,
            };
        }
    }

    private async extractReflectionCandidates(
        message: GatewayMessage,
        context: RuntimeContext,
        visibleText: string,
        blackboardRun: RuntimeBlackboardRun | undefined,
    ) {
        if (!shouldExtractReflection(blackboardRun)) {
            return [];
        }
        return extractRuntimeReflectionCandidates(this.model, {
            answer: visibleText,
            blackboard: blackboardRun
                ? {
                      decisions: blackboardRun.decisions.map((decision) => ({
                          prompt: decision.prompt,
                          reason: decision.reason,
                      })),
                      mode: blackboardRun.mode,
                      reason: blackboardRun.reason,
                      status: blackboardRun.status,
                      steps: blackboardRun.steps.map((step) => ({
                          blockers: step.blockers,
                          newFacts: step.newFacts,
                          outputSummary: step.outputSummary,
                          workerRole: step.workerRole,
                      })),
                      turnId: blackboardRun.turnId,
                  }
                : undefined,
            now: context.now,
            request: message.text,
            requestId: context.requestId,
            route: readRouteMetadata(blackboardRun?.metadata),
        });
    }
}

function blackboardRunFromTurn(
    turn: BlackboardTurn | undefined,
    started: number,
    route: RuntimeBlackboardRouteDecision,
): RuntimeBlackboardRun {
    return {
        elapsedMs: elapsed(started),
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

function renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
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

function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    return `${renderReplyPrefix(run)}${finalAnswer}`;
}

function renderReplyPrefix(run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode !== BlackboardMode.Blackboard) {
        return "";
    }
    return [...renderBlackboardTranscript(run), ...renderDecisionLines(run), "", "Final answer:", ""].join("\n");
}

function routeMetadata(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
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

function readRouteMetadata(metadata: Record<string, unknown> | undefined): RuntimeBlackboardRouteDecision | undefined {
    const route = metadata?.route;
    if (!route || typeof route !== "object") {
        return undefined;
    }
    const candidate = route as Partial<RuntimeBlackboardRouteDecision>;
    if (
        typeof candidate.reason === "string" &&
        typeof candidate.score === "number" &&
        Array.isArray(candidate.signals) &&
        typeof candidate.raw === "string" &&
        (candidate.mode === BlackboardMode.Direct ||
            candidate.mode === BlackboardMode.DirectWithWatch ||
            candidate.mode === BlackboardMode.Blackboard)
    ) {
        return {
            mode: candidate.mode,
            blackboardContract: isBlackboardContract(candidate.blackboardContract)
                ? candidate.blackboardContract
                : normalBlackboardContract(),
            needsReflectionCandidate: candidate.needsReflectionCandidate === true,
            raw: candidate.raw,
            reason: candidate.reason,
            score: candidate.score,
            signals: candidate.signals.filter((item): item is string => typeof item === "string"),
            workers: Array.isArray(candidate.workers) ? candidate.workers : [],
        };
    }
    return undefined;
}

function isBlackboardContract(value: unknown): value is RuntimeBlackboardRouteDecision["blackboardContract"] {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as { mode?: unknown };
    return candidate.mode === "normal" || candidate.mode === "non-convergent";
}

function normalBlackboardContract(): RuntimeBlackboardRouteDecision["blackboardContract"] {
    return {
        contradictions: [],
        evidence: [],
        mode: "normal",
        policyReason: "default-convergence",
    };
}

function shouldExtractReflection(run: RuntimeBlackboardRun | undefined): boolean {
    if (!run) {
        return false;
    }
    const route = readRouteMetadata(run.metadata);
    return run.mode === BlackboardMode.Blackboard || route?.needsReflectionCandidate === true;
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
    const messages = run.transcript.filter(
        (message) => message.round === round && message.visibility === "public" && !isDecisionFormMessage(message),
    );
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

function isDecisionFormMessage(message: BlackboardMessage): boolean {
    return message.metadata.event === "blackboard.needs-user" || message.content.includes("flyflor-decision-form");
}

function compactDialogueText(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}

function renderBlackboardState(run: RuntimeBlackboardRun, round: number): string {
    const policy = policyReasonForRound(run, round);
    const phase = phaseForRound(run, round, policy);
    const plan = planSummaryForRun(run);
    const status =
        round < latestRound(run) ? BlackboardTurnStatus.Running : (run.status ?? BlackboardTurnStatus.Running);
    if (policy === "declared-non-convergent-contract" && status === BlackboardTurnStatus.Running && round > 1) {
        return `phase=${phase}; plan=${plan}; policy=${policy}; unresolved-contract=true; continue-to-hard-cap=true`;
    }
    return `phase=${phase}; plan=${plan}; policy=${policy}; status=${status}`;
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

function elapsed(started: number): number {
    return Number((performance.now() - started).toFixed(3));
}

function filterVisibleMemoryActionText(text: string): string {
    const filter = new MemoryActionVisibilityFilter();
    return `${filter.push(text)}${filter.finish()}`;
}

class MemoryActionVisibilityFilter {
    private buffer = "";
    private hidden = false;

    push(chunk: string): string {
        this.buffer += chunk;
        let output = "";
        while (this.buffer) {
            if (this.hidden) {
                const closeIndex = this.buffer.indexOf("</flyflor_memory_actions>");
                if (closeIndex < 0) {
                    this.buffer = keepSuffix(this.buffer, "</flyflor_memory_actions>");
                    return output;
                }
                this.buffer = this.buffer.slice(closeIndex + "</flyflor_memory_actions>".length);
                this.hidden = false;
                continue;
            }

            const openIndex = this.buffer.indexOf("<flyflor_memory_actions>");
            if (openIndex >= 0) {
                output += this.buffer.slice(0, openIndex);
                this.buffer = this.buffer.slice(openIndex + "<flyflor_memory_actions>".length);
                this.hidden = true;
                continue;
            }

            const emitLength = Math.max(0, this.buffer.length - "<flyflor_memory_actions>".length + 1);
            if (emitLength === 0) {
                return output;
            }
            output += this.buffer.slice(0, emitLength);
            this.buffer = this.buffer.slice(emitLength);
        }
        return output;
    }

    finish(): string {
        const output = this.hidden ? "" : this.buffer;
        this.buffer = "";
        this.hidden = false;
        return output;
    }
}

function keepSuffix(value: string, token: string): string {
    return value.slice(Math.max(0, value.length - token.length + 1));
}

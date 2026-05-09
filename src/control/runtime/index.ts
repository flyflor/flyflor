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
import { type BlackboardController, type BlackboardMessage, type BlackboardTurn } from "../blackboard/index.ts";
import { scopeFor } from "../session/index.ts";
import { loadSkills, renderSkillPrompt, selectSkills } from "../../core/skills/index.ts";

export { startHumanChat } from "./chat.ts";

interface RuntimeBlackboardRun {
    elapsedMs: number;
    mode: "blackboard" | "direct";
    reason: string;
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
    const lines = run.transcript
        .filter((message) => message.role !== "adapter")
        .map((message) => {
            const label = message.workerRole ? `${message.role}/${message.workerRole}` : message.role;
            return `- round=${message.round ?? "-"} visibility=${message.visibility} ${label}: ${message.content}`;
        });
    return [
        "Use the blackboard as advisory context. The main model still makes the final answer.",
        `turnId=${run.turnId ?? "unknown"} status=${run.status ?? "unknown"} reason=${run.reason} elapsedMs=${run.elapsedMs}`,
        ...lines,
        ...run.steps.map(
            (step) =>
                `- step round=${step.round} worker=${step.workerRole} risk=${step.risk} facts=${step.newFacts.join("；") || "-"} blockers=${step.blockers.join("；") || "-"} output=${step.outputSummary}`,
        ),
    ].join("\n");
}

function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode === "direct") {
        return finalAnswer;
    }
    const rounds = [
        ...new Set([...run.transcript.map((message) => message.round ?? 0), ...run.steps.map((step) => step.round)]),
    ]
        .filter((round) => round > 0)
        .sort((left, right) => left - right);
    const discussion = rounds.flatMap((round) => renderRound(run, round));
    const unrounded = run.transcript.filter((message) => !message.round);
    return [
        "黑板讨论：",
        `- turn: ${run.turnId ?? "unknown"}；状态：${run.status ?? "unknown"}；耗时：${run.elapsedMs}ms；原因：${run.reason}`,
        ...unrounded.map(renderMessageLine),
        ...discussion,
        "",
        "最终回答：",
        finalAnswer,
    ].join("\n");
}

function renderRound(run: RuntimeBlackboardRun, round: number): string[] {
    const messages = run.transcript.filter((message) => message.round === round);
    const steps = run.steps.filter((step) => step.round === round);
    return [
        "",
        `第 ${round} 轮：`,
        ...messages.map(renderMessageLine),
        ...steps.flatMap((step) => [
            `- step/${step.workerRole}:`,
            `  - input: ${step.inputSummary}`,
            `  - output: ${step.outputSummary}`,
            `  - newFacts: ${step.newFacts.length > 0 ? step.newFacts.join("；") : "-"}`,
            `  - blockers: ${step.blockers.length > 0 ? step.blockers.join("；") : "-"}`,
            `  - risk: ${step.risk}`,
            `  - metadata: ${JSON.stringify(step.metadata)}`,
        ]),
    ];
}

function renderMessageLine(message: BlackboardMessage): string {
    const label = readableBlackboardLabel(message);
    if (message.role === "adapter" && message.visibility === "internal") {
        return `- ${message.visibility}/${label}: dispatch；完整输入见下方 step/${label}.input`;
    }
    return `- ${message.visibility}/${label}: ${message.content}`;
}

function readableBlackboardLabel(message: BlackboardMessage): string {
    if (message.workerRole) {
        return message.workerRole;
    }
    return message.role;
}

function elapsed(started: number): number {
    return Number((performance.now() - started).toFixed(3));
}

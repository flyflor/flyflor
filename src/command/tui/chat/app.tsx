/**
 * Chat TUI 应用根 — 原生终端消息流
 *
 * 这里刻意不创建 OpenTUI renderer / ScrollBox / Textarea：聊天内容直接写入
 * stdout，输入走 readline，滚动、复制和系统滚动条完全交给终端原生能力。
 */

import { createInterface, type Interface } from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { resolve } from "node:path";
import {
    Channel,
    ChatType,
    type ContextForkRecord,
    type GatewayMessage,
    type ProjectRecord,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../../protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";
import type { BlackboardTurn } from "../../../agent/blackboard/index.ts";
import type { ChatEntryOptions } from "./index.ts";
import { formatAskSummaryLines } from "./ask.render.ts";
import {
    readAskMeta,
    readBlackboardMeta,
    readMcpTrace,
    readPlanningMeta,
    readRecord,
    readStringArray,
} from "./metadata.parse.ts";
import type { ChatMessage, McpTrace, Phase } from "./types.ts";
import {
    AppCommandAction,
    AppCommandRunType,
    builtinActionOf,
    commandSuggestions as appCommandSuggestions,
    createDefaultAppCommandRegistry,
    matchAppCommand,
    type AppCommandRegistry,
    type AppCommandSuggestion,
} from "../../app.commands.ts";

const CHAT_HEADER_BRAND = "◉ flyflor-chat";
const DEFAULT_STATUS_TEXT = "Enter 发送 | /history /project /projects /fork /forks /stop /clear /exit";
const SEND_ICON_TEXT = ">";
const HISTORY_BATCH_SIZE = 20;
const RESOURCE_BAR_WIDTH = 12;
export const NO_PLAN_TEXT = "暂无计划";
export const CHAT_INLINE_SECTIONS = [
    "Questions",
    "Blackboard",
    "TODO List",
    "MODEL",
    "TOKENS",
    "CONTEXT WINDOW",
] as const;

export const CHAT_SCROLL_LOCK_CONTRACT = {
    chatStickyScroll: false,
    chatStickyStart: "native-terminal" as const,
    terminalMouse: false,
    terminalScreenMode: "main-screen" as const,
    wheelRouting: "native-terminal-scrollback",
} as const;

interface ChatTerminalAppOptions extends ChatEntryOptions {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WriteStream;
}

interface ForkHistorySource {
    assistantText: string;
    eventId: string;
    ts: number;
    userText: string;
}

interface ChatTurnState {
    assistant?: ChatMessage;
    user: ChatMessage;
}

/**
 * 原生终端 chat app。生命周期边界：start() 独占 readline，stop() 只恢复本实例创建的资源。
 */
export class NativeChatApp {
    private readonly appCommands: AppCommandRegistry;
    private readonly agentName: string;
    private readonly input: NodeJS.ReadableStream;
    private readonly output: NodeJS.WriteStream;
    private readonly userId: string;
    private readonly blackboardTurns = new Map<string, BlackboardTurn>();
    private readonly loadedHistoryEventIds = new Set<string>();
    private readonly messages: ChatMessage[] = [];
    private activeFork: ContextForkRecord | null = null;
    private activeProject: ProjectRecord | null = null;
    private currentTurnController: AbortController | undefined;
    private currentTurnId: string | null = null;
    private destroyed = false;
    private historyExhausted = false;
    private oldestHistoryTs: number | undefined;
    private phase: Phase = "idle";
    private processing = false;
    private readline: Interface | undefined;
    private unsubscribeEvents: (() => void) | undefined;

    public constructor(private readonly options: ChatTerminalAppOptions) {
        this.agentName = options.agentName ?? "flyflor";
        this.appCommands = options.appCommands ?? createDefaultAppCommandRegistry();
        this.input = options.input ?? defaultInput;
        this.output = options.output ?? defaultOutput;
        this.userId = options.userId ?? "human";
    }

    public async start(): Promise<void> {
        await this.options.runtime.warmup();
        this.subscribeEvents();
        this.readline = createInterface({
            input: this.input,
            output: this.output,
            terminal: this.isInteractiveTerminal(),
        });
        this.writeLine(`${CHAT_HEADER_BRAND} · ${DEFAULT_STATUS_TEXT}`);
        this.writeLine("原生终端滚动：不使用虚拟滚动条，不固定聊天框高度。\n");
        this.renderRecentHistory();
        while (!this.destroyed) {
            const prompt = this.processing ? "queued> " : `${SEND_ICON_TEXT} `;
            const text = await this.readline.question(prompt).catch((cause) => {
                if (this.destroyed) return "";
                throw cause;
            });
            if (this.destroyed) break;
            await this.handleInput(text.trim());
        }
        this.stop();
    }

    public stop(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.currentTurnController?.abort();
        this.unsubscribeEvents?.();
        this.readline?.close();
    }

    private subscribeEvents(): void {
        if (!this.options.eventBus) return;
        const sink: EventSink = {
            publish: (event: RuntimeEvent) => {
                const payload = readRecord(event.payload);
                if (event.type === RuntimeEventType.AgentTurnStart) {
                    this.phase = "thinking";
                    return;
                }
                if (event.type === RuntimeEventType.McpToolCallExecuted) {
                    this.phase = "mcp";
                    this.recordMcpTrace(payload);
                    return;
                }
                if (this.isBlackboardEvent(event.type)) {
                    this.phase = "blackboard";
                    void this.applyBlackboardEvent(event.type, payload);
                    return;
                }
                if (event.type === RuntimeEventType.SkillContextBuilt) {
                    this.phase = "skill";
                    this.recordSkillNames(payload);
                }
            },
        };
        this.unsubscribeEvents = this.options.eventBus.subscribe(sink);
    }

    private isBlackboardEvent(type: string): type is RuntimeEventType {
        return (
            type === RuntimeEventType.BlackboardWorkerStart ||
            type === RuntimeEventType.BlackboardWorkerEnd ||
            type === RuntimeEventType.BlackboardTurnStart ||
            type === RuntimeEventType.BlackboardTurnEnd ||
            type === RuntimeEventType.BlackboardDecisionRequested ||
            type === RuntimeEventType.BlackboardMessageAppended
        );
    }

    private async handleInput(text: string): Promise<void> {
        if (!text) return;
        const matchedCommand = matchAppCommand(this.appCommands, text);
        const matchedAction = matchedCommand ? builtinActionOf(matchedCommand.rule) : undefined;
        if (matchedAction && matchedCommand) {
            await this.runBuiltinCommand(matchedAction, text, matchedCommand);
            return;
        }
        if (matchedCommand?.rule.run.type === AppCommandRunType.SendMessage) {
            await this.sendMessage(matchedCommand.rule.run.prompt);
            return;
        }
        if (text.startsWith("/")) {
            this.writeLine(`Unknown command: ${text}. Try ${this.knownCommandList()}.`);
            return;
        }
        await this.sendMessage(text);
    }

    private async runBuiltinCommand(
        action: AppCommandAction,
        text: string,
        matchedCommand: AppCommandSuggestion,
    ): Promise<void> {
        if (action === AppCommandAction.Clear) {
            this.messages.length = 0;
            this.loadedHistoryEventIds.clear();
            this.oldestHistoryTs = undefined;
            this.historyExhausted = false;
            this.writeLine("conversation view cleared");
            return;
        }
        if (action === AppCommandAction.History) {
            this.renderOlderHistory("manual");
            return;
        }
        if (action === AppCommandAction.Bottom) {
            this.writeLine("Already using terminal native scrollback; latest output is below.");
            return;
        }
        if (action === AppCommandAction.Stop) {
            this.stopCurrentTurn();
            return;
        }
        if (action === AppCommandAction.Continue) {
            await this.sendMessage(matchedCommand.rule.prompt ?? "");
            return;
        }
        if (action === AppCommandAction.OpenThinking || action === AppCommandAction.OpenBlackboard) {
            this.renderTurnDetails(action === AppCommandAction.OpenThinking ? "thinking" : "blackboard", text);
            return;
        }
        if (action === AppCommandAction.Project) {
            await this.useProjectFromInput(text);
            return;
        }
        if (action === AppCommandAction.Projects) {
            this.renderProjectList();
            return;
        }
        if (action === AppCommandAction.Fork) {
            await this.forkFromHistory(text);
            return;
        }
        if (action === AppCommandAction.Forks) {
            this.renderForkList();
            return;
        }
        if (action === AppCommandAction.Exit) {
            this.stop();
        }
    }

    private async sendMessage(text: string): Promise<void> {
        if (!text.trim()) return;
        if (this.processing) {
            this.writeLine("A reply is already running. Use /stop before sending another message.");
            return;
        }
        const turnId = crypto.randomUUID();
        const startedAt = new Date().toISOString();
        const controller = new AbortController();
        this.currentTurnId = turnId;
        this.currentTurnController = controller;
        this.processing = true;
        this.phase = "thinking";

        const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: text.trim(),
            status: "done",
        };
        const assistantMessage: ChatMessage = {
            id: turnId,
            role: "assistant",
            content: "",
            status: "streaming",
            mcpCalls: [],
            skills: [],
        };
        this.messages.push(userMessage, assistantMessage);
        this.writeLine(`\nYou: ${userMessage.content}`);
        this.write(`${this.agentName}: `);

        const context = this.buildRuntimeContext(startedAt);
        const message = this.buildGatewayMessage(text.trim(), startedAt);
        let streamed = false;
        try {
            const reply = await this.options.runtime.handleMessage(message, context, {
                approveMcpToolCall: this.options.approveMcpToolCall ?? (async () => true),
                signal: controller.signal,
                onTextDelta: (chunk) => {
                    if (controller.signal.aborted) return;
                    streamed = true;
                    assistantMessage.content += chunk;
                    this.write(chunk);
                    this.phase = "streaming";
                },
            });
            const metadata = readRecord(reply.metadata) ?? null;
            assistantMessage.content = reply.text;
            assistantMessage.status = "done";
            assistantMessage.ask = readAskMeta(metadata);
            assistantMessage.blackboard = readBlackboardMeta(metadata);
            assistantMessage.planning = readPlanningMeta(metadata);
            assistantMessage.metadata = metadata;
            assistantMessage.mcpCalls = this.mergeMcpTraces(
                assistantMessage.mcpCalls ?? [],
                metadata?.mcpToolExecutions,
            );
            const skills = readStringArray(metadata?.skills);
            if (skills.length > 0)
                assistantMessage.skills = Array.from(new Set([...(assistantMessage.skills ?? []), ...skills]));
            if (!streamed) this.write(reply.text);
            this.writeLine("");
            await this.refreshBlackboardForMessage(assistantMessage);
            this.renderMessageExtras(assistantMessage, text);
        } catch (cause) {
            assistantMessage.status = controller.signal.aborted ? "stopped" : "error";
            assistantMessage.content = controller.signal.aborted ? "Stopped." : this.describeError(cause);
            this.writeLine(controller.signal.aborted ? "\nStopped." : `\nerror: ${assistantMessage.content}`);
        } finally {
            this.currentTurnId = null;
            if (this.currentTurnController === controller) this.currentTurnController = undefined;
            this.processing = false;
            this.phase = "idle";
        }
    }

    private buildRuntimeContext(now: string): RuntimeContext {
        return {
            now,
            requestId: crypto.randomUUID(),
            ...(this.activeFork ? { contextForkId: this.activeFork.id } : {}),
            ...(this.activeProject
                ? {
                      activeProject: {
                          id: this.activeProject.id,
                          title: this.activeProject.title,
                          projectDir: this.activeProject.projectDir,
                          projectMemoryDir: this.activeProject.projectMemoryDir,
                      },
                  }
                : {}),
        };
    }

    private buildGatewayMessage(text: string, receivedAt: string): GatewayMessage {
        return {
            id: crypto.randomUUID(),
            receivedAt,
            route: { channel: Channel.Stdio, chatId: "chat-entry", chatType: ChatType.Direct },
            text,
            user: { id: this.userId },
        };
    }

    private stopCurrentTurn(): void {
        if (!this.processing || !this.currentTurnController) {
            this.writeLine("No active reply to stop.");
            return;
        }
        this.currentTurnController.abort();
        this.writeLine("Stopping current reply...");
    }

    private renderRecentHistory(): void {
        const turns = this.options.runtime.listChatHistory(this.userId, { limit: HISTORY_BATCH_SIZE }).reverse();
        if (turns.length === 0) return;
        this.writeLine("Recent history:");
        for (const turn of turns) this.renderHistoryTurn(turn);
        this.writeLine("");
    }

    private renderOlderHistory(reason: "manual" | "startup"): void {
        if (this.historyExhausted) {
            this.writeLine("No older history.");
            return;
        }
        const turns = this.options.runtime.listChatHistory(this.userId, {
            beforeTs: this.oldestHistoryTs === undefined ? undefined : this.oldestHistoryTs - 1,
            limit: HISTORY_BATCH_SIZE,
        });
        if (turns.length === 0) {
            this.historyExhausted = true;
            this.writeLine(reason === "manual" ? "No history turns." : "");
            return;
        }
        this.writeLine("History:");
        for (const turn of turns.reverse()) this.renderHistoryTurn(turn);
        this.writeLine("");
    }

    private renderHistoryTurn(turn: {
        assistantText: string;
        contextForks?: unknown[];
        eventId: string;
        scenes?: unknown[];
        taskPlans?: unknown[];
        ts: number;
        userText: string;
    }): void {
        if (this.loadedHistoryEventIds.has(turn.eventId)) return;
        this.loadedHistoryEventIds.add(turn.eventId);
        this.oldestHistoryTs = this.oldestHistoryTs === undefined ? turn.ts : Math.min(this.oldestHistoryTs, turn.ts);
        this.writeLine(`- ${new Date(turn.ts).toLocaleString()}`);
        this.writeLine(`  You: ${this.clipText(turn.userText, 140)}`);
        this.writeLine(`  ${this.agentName}: ${this.clipText(turn.assistantText, 180)}`);
        const planning = readPlanningMeta({
            planning: {
                taskPlans: turn.taskPlans ?? [],
                contextForks: turn.contextForks ?? [],
                scenes: turn.scenes ?? [],
            },
        });
        if (planning) this.renderPlanningLines(planning, "  ");
    }

    private renderTurnDetails(mode: "blackboard" | "thinking", text: string): void {
        const pair = this.selectedTurnPair(text);
        if (!pair?.assistant) {
            this.writeLine(`/${mode} has no sent questions yet.`);
            return;
        }
        this.writeLine(`${mode}: ${this.clipText(pair.user.content, 120)}`);
        const turn = this.blackboardTurnFor(pair.assistant);
        if (turn) this.renderBlackboardTurn(turn, "  ");
        if (pair.assistant.planning) this.renderPlanningLines(pair.assistant.planning, "  ");
        this.renderMessageExtras(pair.assistant, pair.user.content);
    }

    private selectedTurnPair(text: string): ChatTurnState | undefined {
        const pairs = this.turnPairs();
        if (pairs.length === 0) return undefined;
        const rawIndex = text.trim().split(/\s+/u)[1];
        const index = rawIndex ? Number.parseInt(rawIndex, 10) : pairs.length;
        if (!Number.isFinite(index)) return pairs[pairs.length - 1];
        return pairs[this.clamp(index - 1, 0, pairs.length - 1)];
    }

    private turnPairs(): ChatTurnState[] {
        const out: ChatTurnState[] = [];
        for (let i = 0; i < this.messages.length; i += 1) {
            const msg = this.messages[i];
            if (!msg || msg.role !== "user" || msg.history) continue;
            const assistant = this.messages.slice(i + 1).find((entry) => entry.role === "assistant" && !entry.history);
            out.push({ user: msg, assistant });
        }
        return out;
    }

    private async useProjectFromInput(text: string): Promise<void> {
        const raw = text.trim().split(/\s+/u).slice(1).join(" ").trim();
        const path = raw.length > 0 ? resolve(raw) : process.cwd();
        try {
            const project = await this.options.runtime.createOrUseProject({
                path,
                title: raw.length > 0 ? raw : undefined,
                userId: this.userId,
                now: Date.now(),
            });
            this.activeProject = project;
            this.writeLine(`Project active: ${project.title}`);
            this.writeLine(`  ${project.projectDir}`);
        } catch (cause) {
            this.writeLine(`Project setup failed: ${this.describeError(cause)}`);
        }
    }

    private renderProjectList(): void {
        const projects = this.options.runtime.listProjects(this.userId, { limit: 50 });
        if (projects.length === 0) {
            this.writeLine("No saved projects yet.");
            return;
        }
        this.writeLine("Projects:");
        projects.forEach((project, index) => {
            this.writeLine(`  ${index + 1}. ${project.title} · ${project.projectDir}`);
        });
        const first = projects[0];
        if (first) {
            this.activeProject = first;
            this.writeLine(`Project active: ${first.title}`);
        }
    }

    private async forkFromHistory(text: string): Promise<void> {
        const loadAll = text
            .trim()
            .split(/\s+/u)
            .some((part) => part === "all");
        const turns = this.options.runtime.listChatHistory(this.userId, { limit: loadAll ? 200 : 20 });
        if (turns.length === 0) {
            this.writeLine("No history turns to fork.");
            return;
        }
        const rawIndex = text
            .trim()
            .split(/\s+/u)
            .find((part) => /^\d+$/u.test(part));
        const selected = rawIndex ? this.clamp(Number.parseInt(rawIndex, 10) - 1, 0, turns.length - 1) : 0;
        const source = this.historySource(turns[selected]!);
        try {
            const fork = await this.options.runtime.createContextFork(
                {
                    id: `fork-${source.eventId}`,
                    userId: this.userId,
                    title: this.clipText(source.userText, 60),
                    summary: this.clipText(`${source.userText} / ${source.assistantText}`, 160),
                    scopeSummary: this.clipText(source.assistantText || source.userText, 180),
                    maxContextTokens: 4096,
                    inheritedEventIds: [source.eventId],
                    createdAt: new Date(source.ts).toISOString(),
                    updatedAt: new Date().toISOString(),
                    sourceEventId: source.eventId,
                },
                { assistantText: source.assistantText, eventId: source.eventId, userText: source.userText },
            );
            this.activeFork = fork;
            this.writeLine(`Fork active: ${fork.title}`);
        } catch (cause) {
            this.writeLine(`Fork setup failed: ${this.describeError(cause)}`);
        }
    }

    private renderForkList(): void {
        const forks = this.options.runtime.listContextForks(this.userId, { limit: 50 });
        if (forks.length === 0) {
            this.writeLine("No saved forks yet.");
            return;
        }
        this.writeLine("Forks:");
        forks.forEach((fork, index) =>
            this.writeLine(`  ${index + 1}. ${fork.title} · ${fork.maxContextTokens} tokens`),
        );
        const first = forks[0];
        if (first) {
            this.activeFork = first;
            this.writeLine(`Fork active: ${first.title}`);
        }
    }

    private historySource(turn: {
        assistantText: string;
        eventId: string;
        ts: number;
        userText: string;
    }): ForkHistorySource {
        return { assistantText: turn.assistantText, eventId: turn.eventId, ts: turn.ts, userText: turn.userText };
    }

    private async applyBlackboardEvent(type: RuntimeEventType, payload: Record<string, unknown> | null): Promise<void> {
        const turnId = this.stringValue(payload?.turnId);
        if (!turnId) return;
        const msg = this.currentAssistantMessage();
        if (msg) {
            msg.blackboard = {
                ...(msg.blackboard ?? { mode: "blackboard" }),
                mode: "blackboard",
                status: type === RuntimeEventType.BlackboardTurnEnd ? this.stringValue(payload?.status) : "running",
                turnId,
            };
        }
        await this.refreshBlackboardTurn(turnId);
    }

    private async refreshBlackboardForMessage(msg: ChatMessage): Promise<void> {
        const turnId = msg.blackboard?.turnId;
        if (turnId) await this.refreshBlackboardTurn(turnId);
    }

    private async refreshBlackboardTurn(turnId: string): Promise<void> {
        if (!this.options.blackboard) return;
        const turn = await this.options.blackboard.getTurn(turnId).catch(() => undefined);
        if (!turn) return;
        this.blackboardTurns.set(turnId, turn);
        for (const msg of this.messages) {
            if (msg.role !== "assistant" || msg.blackboard?.turnId !== turnId) continue;
            msg.blackboardTurn = turn;
            msg.blackboard = {
                ...(msg.blackboard ?? { mode: turn.mode }),
                mode: turn.mode,
                status: turn.status,
                turnId,
            };
        }
    }

    private recordMcpTrace(payload: Record<string, unknown> | null): void {
        const trace = readMcpTrace(payload);
        const msg = this.currentAssistantMessage();
        if (!trace || !msg) return;
        msg.mcpCalls = this.mergeMcpTraces(msg.mcpCalls ?? [], [trace]);
    }

    private recordSkillNames(payload: Record<string, unknown> | null): void {
        const names = readStringArray(payload?.skillNames);
        const msg = this.currentAssistantMessage();
        if (names.length === 0 || !msg) return;
        msg.skills = Array.from(new Set([...(msg.skills ?? []), ...names]));
    }

    private currentAssistantMessage(): ChatMessage | undefined {
        const id = this.currentTurnId;
        return id ? this.messages.find((msg) => msg.id === id && msg.role === "assistant") : undefined;
    }

    private mergeMcpTraces(existing: McpTrace[], raw: unknown): McpTrace[] {
        const next = [...existing];
        const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const item of values) {
            const trace = readMcpTrace(item);
            if (!trace) continue;
            const key = JSON.stringify([trace.server, trace.tool, trace.ok, trace.resultText]);
            if (!next.some((entry) => JSON.stringify([entry.server, entry.tool, entry.ok, entry.resultText]) === key)) {
                next.push(trace);
            }
        }
        return next;
    }

    private renderMessageExtras(msg: ChatMessage, questionText = ""): void {
        const lines = this.messageExtraLines(msg, questionText);
        if (lines.length === 0) return;
        for (const line of lines) this.writeLine(line);
        this.writeLine("");
    }

    private messageExtraLines(msg: ChatMessage, questionText: string): string[] {
        const lines: string[] = [];
        if (msg.ask) {
            lines.push("ask:");
            lines.push(...formatAskSummaryLines(msg.ask).map((line) => `  ${line.trim()}`));
        }
        if (msg.mcpCalls && msg.mcpCalls.length > 0) {
            for (const call of msg.mcpCalls) {
                lines.push(`mcp: ${call.ok ? "ok" : "fail"} ${call.server}.${call.tool}`);
                if (call.resultText) lines.push(`  ${this.clipText(call.resultText, 140)}`);
            }
        }
        if (msg.skills && msg.skills.length > 0) lines.push(`skills: ${msg.skills.join(", ")}`);
        if (msg.planning) this.appendPlanningLines(lines, msg.planning);
        const turn = this.blackboardTurnFor(msg);
        if (turn) this.appendBlackboardLines(lines, turn);
        else if (msg.blackboard?.turnId) lines.push(`blackboard: ${msg.blackboard.status ?? "running"}`);
        if (msg.role === "assistant" && !msg.history) {
            const snapshot = ChatResourceSnapshotBuilder.default.build({
                activeFork: this.activeFork,
                activeProject: this.activeProject,
                draftText: "",
                maxOutputTokens: this.options.resourceConfig?.maxOutputTokens,
                contextPressureBudgetTokens: this.options.resourceConfig?.contextPressureBudgetTokens,
                contextRingSize: this.options.resourceConfig?.contextRingSize,
                identityAppendDailyLimit: this.options.resourceConfig?.identityAppendDailyLimit,
                memoryVisibilityThreshold: this.options.resourceConfig?.memoryVisibilityThreshold,
                model: this.options.resourceConfig?.model,
                providerId: this.options.resourceConfig?.providerId,
                questionText,
                reply: msg,
                turnCount: this.turnPairs().length,
            });
            lines.push(`model: ${snapshot.modelLine}`);
            lines.push(
                `tokens: input ${this.formatTokenCount(snapshot.tokens.input)} · output ${this.formatTokenCount(snapshot.tokens.output)} · total ${this.formatTokenCount(snapshot.tokens.total)}`,
            );
            lines.push(`context: ${snapshot.contextWindow.usedLabel}`);
            lines.push(`memory: ${snapshot.memoryLine}`);
        }
        return lines;
    }

    private renderPlanningLines(planning: NonNullable<ChatMessage["planning"]>, prefix: string): void {
        const lines: string[] = [];
        this.appendPlanningLines(lines, planning);
        for (const line of lines) this.writeLine(`${prefix}${line}`);
    }

    private appendPlanningLines(lines: string[], planning: NonNullable<ChatMessage["planning"]>): void {
        for (const plan of planning.taskPlans.slice(0, 3)) {
            lines.push(`todo: ${plan.title} · ${plan.status} · ${Math.round(plan.progress * 100)}%`);
            for (const step of (plan.steps ?? []).slice(0, 5)) lines.push(`  ${step.status} ${step.title}`);
        }
        for (const scene of planning.scenes.slice(0, 2)) {
            lines.push(`replay: ${scene.kind} · ${scene.title}`);
            lines.push(`  ${this.clipText(scene.summary, 140)}`);
        }
        for (const fork of planning.contextForks.slice(0, 2))
            lines.push(`fork: ${fork.title} · budget=${fork.maxContextTokens}`);
    }

    private renderBlackboardTurn(turn: BlackboardTurn, prefix: string): void {
        const lines: string[] = [];
        this.appendBlackboardLines(lines, turn);
        for (const line of lines) this.writeLine(`${prefix}${line}`);
    }

    private appendBlackboardLines(lines: string[], turn: BlackboardTurn): void {
        lines.push(`blackboard: ${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`);
        const snapshot = ChatTodoSnapshotBuilder.default.build(turn);
        if (snapshot.stepCount === 0 && snapshot.workstreamCount === 0) lines.push(`todo: ${NO_PLAN_TEXT}`);
        else {
            lines.push(`todo: ${snapshot.progressLine}`);
            if (snapshot.workerLine) lines.push(`  ${snapshot.workerLine}`);
            for (const item of snapshot.workstreams) lines.push(`  ${item}`);
        }
        for (const step of turn.steps.slice(-4))
            lines.push(`  r${step.round} ${step.workerRole}: ${this.clipText(step.outputSummary, 120)}`);
        const decision = turn.decisions[turn.decisions.length - 1];
        if (decision) lines.push(`decision: ${this.clipText(decision.prompt, 160)}`);
    }

    private blackboardTurnFor(msg: ChatMessage): BlackboardTurn | undefined {
        if (msg.blackboardTurn) return msg.blackboardTurn;
        const turnId = msg.blackboard?.turnId;
        return turnId ? this.blackboardTurns.get(turnId) : undefined;
    }

    private knownCommandList(): string {
        const names = this.appCommands.rules
            .filter((rule) => rule.enabled)
            .map((rule) => rule.match.slash[0])
            .filter((name): name is string => typeof name === "string" && name.length > 0)
            .slice(0, 10);
        const suggestions = appCommandSuggestions(this.appCommands, "/").map((item) => item.name);
        return names.length > 0 ? names.join(", ") : suggestions.join(", ");
    }

    private clipText(value: string, max = 140): string {
        const text = value.replace(/\s+/gu, " ").trim();
        return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
    }

    private describeError(cause: unknown): string {
        if (cause instanceof Error)
            return cause.name && cause.name !== "Error" ? `${cause.name}: ${cause.message}` : cause.message;
        return String(cause);
    }

    private stringValue(value: unknown): string | undefined {
        return typeof value === "string" ? value : undefined;
    }

    private formatTokenCount(value: number): string {
        return Math.max(0, Math.floor(value)).toLocaleString("en-US");
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private isInteractiveTerminal(): boolean {
        const input = this.input as NodeJS.ReadableStream & { isTTY?: boolean };
        const output = this.output as NodeJS.WriteStream & { isTTY?: boolean };
        return input.isTTY === true && output.isTTY === true;
    }

    private write(text: string): void {
        this.output.write(text);
    }

    private writeLine(text: string): void {
        this.output.write(`${text}\n`);
    }
}

export async function startNativeChatApp(options: ChatTerminalAppOptions): Promise<void> {
    const app = new NativeChatApp(options);
    await app.start();
}

export interface ChatChromeLayout {
    headerBrand: string;
    inlineSections: readonly string[];
    inputStatusText: string;
    sendIconText: string;
    sidePanelVisible: boolean;
    sidePanelWidth: number;
    terminalScreenMode: typeof CHAT_SCROLL_LOCK_CONTRACT.terminalScreenMode;
    usesFixedMessageViewport: boolean;
    usesOpenTuiRenderer: boolean;
    usesVirtualScrollbar: boolean;
}

export interface ChatResourceMetric {
    bar: string;
    label: string;
    ratio?: number;
    value: string;
}

export interface ChatResourceSnapshot {
    contextWindow: {
        limitLabel: string;
        usedLabel: string;
    };
    memoryLine: string;
    metrics: ChatResourceMetric[];
    modelLine: string;
    tokens: {
        draft: number;
        input: number;
        output: number;
        total: number;
    };
}

export interface ChatTodoSnapshot {
    progressLine: string;
    stepCount: number;
    steps: string[];
    workerLine?: string;
    workstreamCount: number;
    workstreams: string[];
}

export interface ChatResourceSnapshotInput {
    activeFork?: ContextForkRecord | null;
    activeProject?: ProjectRecord | null;
    contextPressureBudgetTokens?: number;
    contextRingSize?: number;
    draftText?: string;
    identityAppendDailyLimit?: number;
    maxOutputTokens?: number;
    memoryVisibilityThreshold?: number;
    model?: string;
    providerId?: string;
    questionText?: string;
    reply?: ChatMessage;
    turnCount?: number;
}

/**
 * TODO 摘要只消费结构化 blackboard turn，不从消息文本反推计划状态。
 */
export class ChatTodoSnapshotBuilder {
    public static readonly default = new ChatTodoSnapshotBuilder();

    public build(turn: BlackboardTurn | undefined): ChatTodoSnapshot {
        if (!turn)
            return { progressLine: "no todo list yet", stepCount: 0, steps: [], workstreamCount: 0, workstreams: [] };
        const metadata = readRecord(turn.metadata);
        const plan = readRecord(metadata?.blackboardPlan);
        const workstreams = readStringArray(plan?.workstreams).slice(0, 6);
        const totalRounds = Math.max(1, turn.budget.maxRounds);
        const stepCount = turn.steps.length;
        const doneWorkers = turn.workers.filter((worker) => worker.status === "done").length;
        const runningWorkers = turn.workers.filter((worker) => worker.status === "running").length;
        const blockedWorkers = turn.workers.filter((worker) => worker.status === "blocked").length;
        return {
            progressLine: `progress ${stepCount}/${totalRounds} rounds · workers ${doneWorkers}/${turn.workers.length}`,
            stepCount,
            steps: turn.steps
                .slice(-4)
                .map((step) => `r${step.round} ${step.workerRole}: ${this.clip(step.outputSummary)}`),
            workerLine:
                turn.workers.length > 0
                    ? `workers ${doneWorkers} done · ${runningWorkers} running · ${blockedWorkers} blocked`
                    : undefined,
            workstreamCount: workstreams.length,
            workstreams,
        };
    }

    private clip(value: string, max = 96): string {
        const text = value.replace(/\s+/gu, " ").trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }
}

/**
 * Chat resource 摘要是终端 UI 展示协议，输入必须是 runtime metadata / 配置数值。
 */
export class ChatResourceSnapshotBuilder {
    public static readonly default = new ChatResourceSnapshotBuilder();

    public build(input: ChatResourceSnapshotInput): ChatResourceSnapshot {
        const replyTokens = this.estimateTokens(input.reply?.content ?? "");
        const questionTokens = this.estimateTokens(input.questionText ?? "");
        const draftTokens = this.estimateTokens(input.draftText ?? "");
        const turnTokens = questionTokens + replyTokens;
        const contextBudget =
            this.finitePositive(input.activeFork?.maxContextTokens) ??
            this.finitePositive(input.contextPressureBudgetTokens) ??
            this.finitePositive(input.maxOutputTokens);
        const outputBudget = this.finitePositive(input.maxOutputTokens);
        const ringSize = this.finitePositive(input.contextRingSize);
        const identityLimit = this.finitePositive(input.identityAppendDailyLimit);
        const memoryActions = this.numberValueFromRecord(input.reply?.metadata, "memoryActions") ?? 0;
        const model = input.model && input.model.trim().length > 0 ? input.model : "model unknown";
        const provider = input.providerId && input.providerId.trim().length > 0 ? input.providerId : "provider unknown";
        const visibility = this.clampRatio(input.memoryVisibilityThreshold);
        return {
            contextWindow: {
                limitLabel: contextBudget ? `${this.formatTokenCount(contextBudget)}` : "unknown",
                usedLabel: contextBudget
                    ? `${this.formatTokenCount(turnTokens)} / ${this.formatTokenCount(contextBudget)}`
                    : `${this.formatTokenCount(turnTokens)} used`,
            },
            memoryLine: [
                `actions ${memoryActions}`,
                `project ${input.activeProject ? "on" : "off"}`,
                `fork ${input.activeFork ? "on" : "off"}`,
            ].join(" · "),
            modelLine: `${provider} · ${model}`,
            metrics: [
                this.metric(
                    "context",
                    contextBudget ? turnTokens / contextBudget : undefined,
                    contextBudget ? `${turnTokens}/${contextBudget} tok` : `${turnTokens} tok`,
                ),
                this.metric(
                    "reply",
                    outputBudget ? replyTokens / outputBudget : undefined,
                    outputBudget ? `${replyTokens}/${outputBudget} tok` : `${replyTokens} tok`,
                ),
                this.metric(
                    "draft",
                    outputBudget ? draftTokens / outputBudget : undefined,
                    outputBudget ? `${draftTokens}/${outputBudget} tok` : `${draftTokens} tok`,
                ),
                this.metric(
                    "memory",
                    ringSize ? (input.turnCount ?? 0) / ringSize : undefined,
                    ringSize ? `${input.turnCount ?? 0}/${ringSize} turns` : `${input.turnCount ?? 0} turns`,
                ),
                this.metric(
                    "recall",
                    visibility,
                    input.memoryVisibilityThreshold === undefined
                        ? "gate unknown"
                        : `gate ${input.memoryVisibilityThreshold.toFixed(2)}`,
                ),
                this.metric(
                    "write",
                    identityLimit ? memoryActions / identityLimit : undefined,
                    identityLimit ? `${memoryActions}/${identityLimit} daily` : `${memoryActions} actions`,
                ),
            ],
            tokens: { draft: draftTokens, input: questionTokens, output: replyTokens, total: turnTokens },
        };
    }

    public renderProgressBar(ratio: number | undefined, width = RESOURCE_BAR_WIDTH): string {
        const size = Math.max(1, Math.floor(width));
        if (ratio === undefined || !Number.isFinite(ratio)) return `${"·".repeat(size)} --%`;
        const bounded = Math.min(1, Math.max(0, ratio));
        const filled = Math.min(size, Math.max(0, Math.round(bounded * size)));
        return `${"█".repeat(filled)}${"░".repeat(size - filled)} ${Math.round(bounded * 100)
            .toString()
            .padStart(2, " ")}%`;
    }

    private metric(label: string, ratio: number | undefined, value: string): ChatResourceMetric {
        return { bar: this.renderProgressBar(ratio), label, ratio: this.clampRatio(ratio), value };
    }

    private estimateTokens(text: string): number {
        const chars = text.trim().length;
        return chars === 0 ? 0 : Math.ceil(chars / 4);
    }

    private finitePositive(value: number | undefined): number | undefined {
        return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
    }

    private formatTokenCount(value: number): string {
        return Math.max(0, Math.floor(value)).toLocaleString("en-US");
    }

    private clampRatio(value: number | undefined): number | undefined {
        if (value === undefined || !Number.isFinite(value)) return undefined;
        return Math.min(1, Math.max(0, value));
    }

    private numberValueFromRecord(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
        const value = record?.[key];
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }
}

/**
 * Chrome contract 只描述 chat 对终端能力的占用，保证不会回退到固定高度 UI。
 */
export class ChatChromeContractBuilder {
    public static readonly default = new ChatChromeContractBuilder();

    public build(totalWidth: number, totalHeight: number): ChatChromeLayout {
        void totalWidth;
        void totalHeight;
        return {
            headerBrand: CHAT_HEADER_BRAND,
            inlineSections: CHAT_INLINE_SECTIONS,
            inputStatusText: DEFAULT_STATUS_TEXT,
            sendIconText: SEND_ICON_TEXT,
            sidePanelVisible: false,
            sidePanelWidth: 0,
            terminalScreenMode: CHAT_SCROLL_LOCK_CONTRACT.terminalScreenMode,
            usesFixedMessageViewport: false,
            usesOpenTuiRenderer: false,
            usesVirtualScrollbar: false,
        };
    }
}

export function buildChatTodoSnapshot(turn: BlackboardTurn | undefined): ChatTodoSnapshot {
    return ChatTodoSnapshotBuilder.default.build(turn);
}

export function buildChatResourceSnapshot(input: ChatResourceSnapshotInput): ChatResourceSnapshot {
    return ChatResourceSnapshotBuilder.default.build(input);
}

export function renderChatProgressBar(ratio: number | undefined, width = RESOURCE_BAR_WIDTH): string {
    return ChatResourceSnapshotBuilder.default.renderProgressBar(ratio, width);
}

export function chatChromeLayout(totalWidth: number, totalHeight: number): ChatChromeLayout {
    return ChatChromeContractBuilder.default.build(totalWidth, totalHeight);
}

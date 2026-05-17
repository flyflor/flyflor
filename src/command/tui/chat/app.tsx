/**
 * Chat TUI 应用根 — 状态管理 + 事件处理 + 命令式 UI 装配
 * 使用 OpenTUI 纯命令式 API，绕过 Solid reconciler 的 ref/事件绑定问题。
 */

import {
    BoxRenderable,
    CliRenderEvents,
    MarkdownRenderable,
    TextRenderable,
    ScrollBoxRenderable,
    TextareaRenderable,
    type CliRenderer,
    type Renderable,
    RGBA,
    TextAttributes,
    SyntaxStyle,
    type Selection,
} from "@opentui/core";
import { createSignal, createEffect, createRoot, batch } from "solid-js";
import {
    Channel,
    ChatType,
    type ContextForkRecord,
    type GatewayMessage,
    type ProjectRecord,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../../protocol/contracts/index.ts";
import { resolve } from "node:path";
import { RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";
import type { ChatEntryOptions } from "./index.ts";
import { formatAskSummaryLines } from "./ask.render.ts";
import { copyTextToTerminalClipboard } from "./clipboard.ts";
import { readAskMeta, readBlackboardMeta, readMcpTrace, readPlanningMeta, readRecord, readStringArray } from "./metadata.parse.ts";
import type { ChatMessage, McpTrace, Phase } from "./types.ts";
import type { BlackboardTurn } from "../../../agent/blackboard/index.ts";
import { createVirtualScrollBar, useDetachedScrollBars } from "../scrollbar.composition.ts";
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

const PHASE_DEF: Record<Phase, { label: string; color: RGBA; done: string; frames: string[] }> = {
    idle: {
        label: "ready",
        color: RGBA.fromInts(126, 232, 218),
        done: "▪",
        frames: ["▪"],
    },
    thinking: {
        label: "thinking",
        color: RGBA.fromInts(255, 203, 116),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    blackboard: {
        label: "blackboard",
        color: RGBA.fromInts(188, 171, 255),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    mcp: {
        label: "mcp",
        color: RGBA.fromInts(123, 229, 180),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    skill: {
        label: "skill",
        color: RGBA.fromInts(255, 151, 190),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    streaming: {
        label: "streaming",
        color: RGBA.fromInts(126, 232, 218),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
};

const THEME = {
    bg: RGBA.fromInts(13, 19, 29),
    panelBg: RGBA.fromInts(16, 23, 37),
    panelBgSoft: RGBA.fromInts(20, 28, 44),
    fg: RGBA.fromInts(235, 244, 246),
    fgMuted: RGBA.fromInts(132, 154, 169),
    gold: RGBA.fromInts(219, 190, 136),
    user: RGBA.fromInts(98, 207, 255),
    assistant: RGBA.fromInts(241, 248, 248),
    error: RGBA.fromInts(255, 111, 127),
    border: RGBA.fromInts(45, 59, 85),
    header: RGBA.fromInts(126, 232, 218),
    pink: RGBA.fromInts(255, 151, 190),
    purple: RGBA.fromInts(188, 171, 255),
    violetBg: RGBA.fromInts(24, 34, 47),
};

const CHAT_HEADER_BRAND = "◉ flyflor-chat · powered by OpenTUI";
const DEFAULT_STATUS_TEXT = "Enter 发送  |  ↑/↓ 历史  |  Tab 切换  |  Ctrl+C 清屏  |  Cmd/Ctrl+C 复制";
const SEND_ICON_TEXT = "➤➤➤";
const CHAT_SCROLL_STICKY_START = "bottom" as const;
const CHAT_TERMINAL_SCREEN_MODE = "alternate-screen" as const;
const HISTORY_BATCH_SIZE = 20;
const SIDE_PANEL_MIN_WIDTH = 34;
const SIDE_PANEL_MAX_WIDTH = 50;
const SIDE_PANEL_RATIO = 0.28;
const METRICS_PANEL_MIN_HEIGHT = 9;
const METRICS_PANEL_MAX_HEIGHT = 13;
const METRICS_PANEL_HEIGHT_RATIO = 0.24;
const TODO_PANEL_MIN_HEIGHT = 6;
const TODO_PANEL_MAX_HEIGHT = 10;
const TODO_PANEL_HEIGHT_RATIO = 0.18;
const RESOURCE_BAR_WIDTH = 12;
export const NO_PLAN_TEXT = "暂无计划";

export const CHAT_SCROLL_LOCK_CONTRACT = {
    chatStickyScroll: true,
    chatStickyStart: CHAT_SCROLL_STICKY_START,
    hiddenScrollbarSize: 0,
    showScrollbars: false,
    sidePanelStickyScroll: true,
    sidePanelStickyStart: CHAT_SCROLL_STICKY_START,
    terminalMouse: true,
    terminalScreenMode: CHAT_TERMINAL_SCREEN_MODE,
    wheelRouting: "opentui-scrollbox",
} as const;

interface MsgRenderable {
    id: string;
    box: BoxRenderable;
    contentBox: BoxRenderable;
    contentRenderable: TextRenderable | MarkdownRenderable;
    contentKey: string;
    extrasKey: string;
    extraBox?: BoxRenderable;
}

interface PanelLine {
    attributes?: number;
    bg?: RGBA;
    content: string;
    fg: RGBA;
}

export type SidePanelMode = "blackboard" | "thinking" | "projects" | "fork" | "forks";
type CommandMenuMode = SidePanelMode | null;
type SelectionScope = "chat" | "side" | null;

interface ForkHistorySource {
    assistantText: string;
    eventId: string;
    ts: number;
    userText: string;
}

type SelectionScopedRenderer = CliRenderer & {
    clearSelection: () => void;
    startSelection: (renderable: Renderable, x: number, y: number) => void;
    updateSelection: (
        renderable: Renderable | undefined,
        x: number,
        y: number,
        options?: { finishDragging?: boolean },
    ) => void;
};

export function createChatApp(renderer: CliRenderer, options: ChatEntryOptions): () => void {
    return createRoot((disposeSolid) => {
        const {
            runtime,
            blackboard,
            eventBus,
            approveMcpToolCall,
            agentName = "flyflor",
            appCommands = createDefaultAppCommandRegistry(),
            resourceConfig = {},
            userId = "human",
        } = options;

        // ── 状态 ──────────────────────────────────────────────
        const [messages, setMessages] = createSignal<ChatMessage[]>([], { equals: false });
        const [phase, setPhase] = createSignal<Phase>("idle");
        const [processing, setProcessing] = createSignal(false);
        const [error, setError] = createSignal<string | null>(null);
        const [frameTick, setFrameTick] = createSignal(0);
        const [inputText, setInputText] = createSignal("");
        const [statusNotice, setStatusNotice] = createSignal<string | null>(null);
        const [blackboardTurns, setBlackboardTurns] = createSignal<Record<string, BlackboardTurn>>(
            {},
            { equals: false },
        );
        const [activeReplyId, setActiveReplyId] = createSignal<string | null>(null);
        const [focusedBlackboardTurnId, setFocusedBlackboardTurnId] = createSignal<string | null>(null);
        const [selectedQuestionIndex, setSelectedQuestionIndex] = createSignal<number | null>(null);
        const [sidePanelMode, setSidePanelMode] = createSignal<SidePanelMode>("blackboard");
        const [commandMenuMode, setCommandMenuMode] = createSignal<CommandMenuMode>(null);
        const [activeProject, setActiveProject] = createSignal<ProjectRecord | null>(null);
        const [activeFork, setActiveFork] = createSignal<ContextForkRecord | null>(null);
        const [projectOptions, setProjectOptions] = createSignal<ProjectRecord[]>([]);
        const [forkOptions, setForkOptions] = createSignal<ContextForkRecord[]>([]);
        const [forkSources, setForkSources] = createSignal<ForkHistorySource[]>([]);
        const [selectedProjectIndex, setSelectedProjectIndex] = createSignal(0);
        const [selectedForkIndex, setSelectedForkIndex] = createSignal(0);
        const [selectedForkSourceIndex, setSelectedForkSourceIndex] = createSignal(0);

        let currentTurnId: string | null = null;
        let currentTurnController: AbortController | undefined;
        let inputRef: TextareaRenderable | undefined;
        let destroyed = false;
        // Shared markdown syntax style for assistant replies; destroyed with the chat root.
        const markdownSyntaxStyle = createMarkdownSyntaxStyle();
        let statusNoticeTimer: ReturnType<typeof setTimeout> | undefined;
        const messageRenderables: MsgRenderable[] = [];
        const metricLineRenderables: TextRenderable[] = [];
        const todoLineRenderables: TextRenderable[] = [];
        const detailLineRenderables: TextRenderable[] = [];
        const pendingBlackboardRefreshes = new Set<string>();
        const loadedHistoryEventIds = new Set<string>();
        let historyOpen = false;
        let historyExhausted = false;
        let historyLoading = false;
        let oldestHistoryTs: number | undefined;
        const selectionRenderer = renderer as SelectionScopedRenderer;
        const originalStartSelection = selectionRenderer.startSelection?.bind(renderer);
        const originalUpdateSelection = selectionRenderer.updateSelection.bind(renderer);
        const originalClearSelection = selectionRenderer.clearSelection.bind(renderer);
        let selectionScope: SelectionScope = null;
        let suppressSelectionReset = false;
        const queuedInputs: string[] = [];

        // ── 动画帧 ────────────────────────────────────────────
        const animTimer = setInterval(() => {
            if (processing() && !destroyed) setFrameTick((t) => t + 1);
        }, 180);
        let historyPollTimer: ReturnType<typeof setInterval> | undefined;

        // ── 事件订阅 ──────────────────────────────────────────
        let unsubscribeEvents: (() => void) | undefined;
        if (eventBus) {
            const sink: EventSink = {
                publish: (event: RuntimeEvent) => {
                    const payload = readRecord(event.payload);
                    batch(() => {
                        if (event.type === RuntimeEventType.AgentTurnStart) {
                            setPhase("thinking");
                        } else if (event.type === RuntimeEventType.McpToolCallExecuted) {
                            const trace = readMcpTrace(payload);
                            if (trace && currentTurnId) {
                                setMessages((prev) => {
                                    const last = prev[prev.length - 1];
                                    if (last && last.id === currentTurnId && last.role === "assistant") {
                                        const merged = [...(last.mcpCalls ?? [])];
                                        const key = JSON.stringify([
                                            trace.server,
                                            trace.tool,
                                            trace.ok,
                                            trace.resultText,
                                        ]);
                                        if (
                                            !merged.some(
                                                (m) => JSON.stringify([m.server, m.tool, m.ok, m.resultText]) === key,
                                            )
                                        ) {
                                            merged.push(trace);
                                        }
                                        last.mcpCalls = merged;
                                    }
                                    return prev;
                                });
                            }
                            setPhase("mcp");
                        } else if (
                            event.type === RuntimeEventType.BlackboardWorkerStart ||
                            event.type === RuntimeEventType.BlackboardWorkerEnd ||
                            event.type === RuntimeEventType.BlackboardTurnStart ||
                            event.type === RuntimeEventType.BlackboardTurnEnd ||
                            event.type === RuntimeEventType.BlackboardDecisionRequested ||
                            event.type === RuntimeEventType.BlackboardMessageAppended
                        ) {
                            setPhase("blackboard");
                            applyBlackboardEvent(event.type, payload);
                        } else if (event.type === RuntimeEventType.SkillContextBuilt) {
                            setPhase("skill");
                            const skillNames = readStringArray(payload?.skillNames);
                            if (skillNames.length > 0 && currentTurnId) {
                                setMessages((prev) => {
                                    const last = prev[prev.length - 1];
                                    if (last && last.id === currentTurnId && last.role === "assistant") {
                                        last.skills = Array.from(new Set([...(last.skills ?? []), ...skillNames]));
                                    }
                                    return prev;
                                });
                            }
                        }
                    });
                },
            };
            unsubscribeEvents = eventBus.subscribe(sink);
        }

        function showStatusNotice(text: string): void {
            setStatusNotice(text);
            if (statusNoticeTimer) clearTimeout(statusNoticeTimer);
            statusNoticeTimer = setTimeout(() => {
                statusNoticeTimer = undefined;
                setStatusNotice(null);
            }, 1600);
        }

        function describeError(cause: unknown): string {
            if (cause instanceof Error) {
                return cause.name && cause.name !== "Error" ? `${cause.name}: ${cause.message}` : cause.message;
            }
            return String(cause);
        }

        function copySelectionToClipboard(): boolean {
            const text = selectedTextForScope(renderer.getSelection(), selectionScope ?? inferredSelectionScope(), {
                chat: scrollBox.content,
                side: sidePanel,
            });
            if (text.trim().length === 0) return false;
            try {
                copyTextToTerminalClipboard(text);
                renderer.clearSelection();
                showStatusNotice(`Copied ${text.length} chars`);
                return true;
            } catch (cause) {
                const messageText = describeError(cause);
                setError(`Copy failed: ${messageText}`);
                console.error(cause);
                return false;
            }
        }

        function inferredSelectionScope(): SelectionScope {
            const selected = renderer.getSelection()?.selectedRenderables ?? [];
            for (const renderable of selected) {
                const scope = scopeForRenderable(renderable);
                if (scope) return scope;
            }
            return null;
        }

        function pruneSelectionToScope(): void {
            const selection = renderer.getSelection();
            const scope = selectionScope ?? inferredSelectionScope();
            if (!selection || !scope) return;
            const container = scope === "chat" ? scrollBox.content : sidePanel;
            selection.updateSelectedRenderables(
                selection.selectedRenderables.filter((renderable) => isWithin(renderable, container)),
            );
            selection.updateTouchedRenderables(
                selection.touchedRenderables.filter((renderable) => isWithin(renderable, container)),
            );
            renderer.requestSelectionUpdate();
        }

        function createMarkdownSyntaxStyle(): SyntaxStyle {
            return SyntaxStyle.fromTheme([
                { scope: ["default"], style: { foreground: THEME.assistant } },
                { scope: ["markup.heading"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.1"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.2"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.3"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.4"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.5"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.heading.6"], style: { foreground: THEME.header, bold: true } },
                { scope: ["markup.bold", "markup.strong"], style: { foreground: THEME.assistant, bold: true } },
                { scope: ["markup.italic"], style: { foreground: THEME.purple, italic: true } },
                { scope: ["markup.list"], style: { foreground: THEME.pink } },
                { scope: ["markup.quote"], style: { foreground: THEME.fgMuted, italic: true } },
                { scope: ["markup.raw", "markup.raw.block"], style: { foreground: THEME.user } },
                { scope: ["markup.raw.inline"], style: { foreground: THEME.user, background: THEME.violetBg } },
                { scope: ["markup.link"], style: { foreground: THEME.user, underline: true } },
                { scope: ["markup.link.label"], style: { foreground: THEME.header, underline: true } },
                { scope: ["markup.link.url"], style: { foreground: THEME.user, underline: true } },
                { scope: ["conceal"], style: { foreground: THEME.fgMuted } },
                { scope: ["label", "spell", "nospell"], style: { foreground: THEME.assistant } },
            ]);
        }

        function stringValue(value: unknown): string | undefined {
            return typeof value === "string" ? value : undefined;
        }

        function applyBlackboardEvent(type: RuntimeEventType, payload: Record<string, unknown> | null): void {
            const turnId = stringValue(payload?.turnId);
            if (!turnId) return;

            setFocusedBlackboardTurnId(turnId);
            setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (!last || last.id !== currentTurnId || last.role !== "assistant") return prev;
                last.blackboard = {
                    ...(last.blackboard ?? { mode: "blackboard" }),
                    mode: "blackboard",
                    status: type === RuntimeEventType.BlackboardTurnEnd ? stringValue(payload?.status) : "running",
                    turnId,
                };
                return prev;
            });
            void refreshBlackboardTurn(turnId);
        }

        async function refreshBlackboardTurn(turnId: string): Promise<void> {
            if (!blackboard || pendingBlackboardRefreshes.has(turnId)) return;
            pendingBlackboardRefreshes.add(turnId);
            try {
                const turn = await blackboard.getTurn(turnId);
                if (!turn) return;
                setBlackboardTurns((prev) => ({ ...prev, [turnId]: turn }));
                setMessages((prev) => {
                    for (const msg of prev) {
                        if (msg.role !== "assistant" || msg.blackboard?.turnId !== turnId) continue;
                        msg.blackboard = {
                            ...(msg.blackboard ?? { mode: turn.mode }),
                            messages: turn.messages.length,
                            mode: turn.mode,
                            status: turn.status,
                            turnId,
                        };
                        msg.blackboardTurn = turn;
                    }
                    return prev;
                });
            } catch (cause) {
                const messageText = describeError(cause);
                setError(`Blackboard refresh failed: ${messageText}`);
                console.error(cause);
            } finally {
                pendingBlackboardRefreshes.delete(turnId);
            }
        }

        function historyMessagesForTurn(turn: {
            assistantText: string;
            contextForks?: unknown[];
            eventId: string;
            scenes?: unknown[];
            taskPlans?: unknown[];
            ts: number;
            userText: string;
        }): ChatMessage[] {
            const planning = planningFromHistoryTurn(turn);
            return [
                {
                    id: `history-${turn.eventId}-user`,
                    role: "user",
                    content: turn.userText,
                    status: "done",
                    history: true,
                    historyEventId: turn.eventId,
                    historyTs: turn.ts,
                },
                {
                    id: `history-${turn.eventId}-assistant`,
                    role: "assistant",
                    content: turn.assistantText,
                    status: "done",
                    history: true,
                    historyEventId: turn.eventId,
                    historyTs: turn.ts,
                    planning,
                },
            ];
        }

        function planningFromHistoryTurn(turn: {
            contextForks?: unknown[];
            scenes?: unknown[];
            taskPlans?: unknown[];
        }): ChatMessage["planning"] {
            const planning = readPlanningMeta({
                planning: {
                    contextForks: turn.contextForks ?? [],
                    scenes: turn.scenes ?? [],
                    taskPlans: (turn.taskPlans ?? []).map((plan) => {
                        const record = readRecord(plan);
                        return record ? { ...record, steps: record.step } : plan;
                    }),
                },
            });
            return planning;
        }

        async function loadOlderHistory(reason: "initial" | "scroll"): Promise<void> {
            if (!historyOpen) return;
            if (historyLoading || historyExhausted) return;
            historyLoading = true;
            const previousHeight = scrollBox.scrollHeight;
            const previousTop = scrollBox.scrollTop;
            try {
                const turns = runtime.listChatHistory(userId, {
                    beforeTs: oldestHistoryTs === undefined ? undefined : oldestHistoryTs - 1,
                    limit: HISTORY_BATCH_SIZE,
                });
                if (turns.length === 0) {
                    historyExhausted = true;
                    return;
                }
                const nextMessages: ChatMessage[] = [];
                for (const turn of turns) {
                    if (loadedHistoryEventIds.has(turn.eventId)) continue;
                    loadedHistoryEventIds.add(turn.eventId);
                    oldestHistoryTs = oldestHistoryTs === undefined ? turn.ts : Math.min(oldestHistoryTs, turn.ts);
                    nextMessages.push(...historyMessagesForTurn(turn));
                }
                if (nextMessages.length === 0) {
                    historyExhausted = true;
                    return;
                }
                setMessages((prev) => [...nextMessages, ...prev]);
                if (reason === "initial") {
                    showStatusNotice(`Loaded ${nextMessages.length / 2} history turns`);
                }
                queueMicrotask(() => {
                    if (reason === "scroll") {
                        const delta = scrollBox.scrollHeight - previousHeight;
                        scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: previousTop + Math.max(0, delta) });
                        return;
                    }
                    scrollBox.scrollTo({
                        x: scrollBox.scrollLeft,
                        y: Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height),
                    });
                });
            } catch (cause) {
                const messageText = describeError(cause);
                setError(`History load failed: ${messageText}`);
                console.error(cause);
            } finally {
                historyLoading = false;
            }
        }

        // ── 发送消息 ──────────────────────────────────────────
        async function sendMessage(text: string): Promise<void> {
            if (!text.trim()) return;
            if (processing()) {
                enqueueInput(text);
                return;
            }

            const turnId = crypto.randomUUID();
            const startedAt = new Date().toISOString();
            const controller = new AbortController();

            batch(() => {
                setMessages((prev) => [
                    ...prev,
                    { id: crypto.randomUUID(), role: "user", content: text.trim(), status: "done" },
                    { id: turnId, role: "assistant", content: "", status: "streaming", mcpCalls: [], skills: [] },
                ]);
                // New live turns return the side rail to follow-latest mode; explicit /thinking or /blackboard
                // selection can still pin older turns until the next user message starts.
                setSelectedQuestionIndex(null);
                setProcessing(true);
                setError(null);
                setPhase("thinking");
            });

            currentTurnId = turnId;
            currentTurnController = controller;
            setActiveReplyId(turnId);

            const context: RuntimeContext = {
                now: startedAt,
                requestId: crypto.randomUUID(),
                ...(activeFork() ? { contextForkId: activeFork()!.id } : {}),
                ...(activeProject()
                    ? {
                          activeProject: {
                              id: activeProject()!.id,
                              title: activeProject()!.title,
                              projectDir: activeProject()!.projectDir,
                              projectMemoryDir: activeProject()!.projectMemoryDir,
                          },
                      }
                    : {}),
            };
            const message: GatewayMessage = {
                id: crypto.randomUUID(),
                receivedAt: startedAt,
                route: {
                    channel: Channel.Stdio,
                    chatId: "chat-entry",
                    chatType: ChatType.Direct,
                },
                text: text.trim(),
                user: { id: userId },
            };

            try {
                const reply = await runtime.handleMessage(message, context, {
                    approveMcpToolCall: approveMcpToolCall ?? (async () => true),
                    signal: controller.signal,
                    onTextDelta: (chunk: string) => {
                        if (controller.signal.aborted) return;
                        setMessages((prev) => {
                            const last = prev[prev.length - 1];
                            if (last && last.id === turnId && last.role === "assistant") {
                                last.content += chunk;
                            }
                            return prev;
                        });
                        setPhase("streaming");
                    },
                });

                const metadata = readRecord(reply.metadata) ?? null;
                const askMeta = readAskMeta(metadata);
                const blackboardMeta = readBlackboardMeta(metadata);
                const planningMeta = readPlanningMeta(metadata);
                if (blackboardMeta?.turnId) {
                    setFocusedBlackboardTurnId(blackboardMeta.turnId);
                    void refreshBlackboardTurn(blackboardMeta.turnId);
                }

                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.id === turnId && last.role === "assistant") {
                        last.content = reply.text;
                        last.status = "done";
                        last.ask = askMeta;
                        last.blackboard = blackboardMeta;
                        last.planning = planningMeta;
                        last.metadata = metadata;
                        const executions = metadata?.mcpToolExecutions;
                        if (Array.isArray(executions)) {
                            const newTraces = executions
                                .map((e) => readMcpTrace(e))
                                .filter((t): t is McpTrace => Boolean(t));
                            const merged = [...(last.mcpCalls ?? [])];
                            for (const trace of newTraces) {
                                const key = JSON.stringify([trace.server, trace.tool, trace.ok, trace.resultText]);
                                if (
                                    !merged.some((m) => JSON.stringify([m.server, m.tool, m.ok, m.resultText]) === key)
                                ) {
                                    merged.push(trace);
                                }
                            }
                            last.mcpCalls = merged;
                        }
                        const skills = readStringArray(metadata?.skills);
                        if (skills.length > 0) {
                            last.skills = Array.from(new Set([...(last.skills ?? []), ...skills]));
                        }
                    }
                    return prev;
                });
            } catch (cause) {
                if (controller.signal.aborted || isAbortError(cause)) {
                    setError("Stopped current reply.");
                    setMessages((prev) => {
                        const last = prev[prev.length - 1];
                        if (last && last.id === turnId && last.role === "assistant") {
                            last.content = last.content || "Stopped.";
                            last.status = "stopped";
                        }
                        return prev;
                    });
                    return;
                }
                const messageText = describeError(cause);
                setError(messageText);
                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.id === turnId && last.role === "assistant") {
                        last.content = last.content || `Error: ${messageText}`;
                        last.status = "error";
                    }
                    return prev;
                });
            } finally {
                currentTurnId = null;
                if (currentTurnController === controller) {
                    currentTurnController = undefined;
                }
                setActiveReplyId(null);
                batch(() => {
                    setProcessing(false);
                    setPhase("idle");
                });
                queueMicrotask(processQueuedInput);
            }
        }

        function stopCurrentTurn(): boolean {
            if (!processing() || !currentTurnController) return false;
            currentTurnController.abort();
            setPhase("idle");
            showStatusNotice("Stopping current reply...");
            return true;
        }

        function enqueueInput(text: string): void {
            queuedInputs.push(text.trim());
            showStatusNotice(`Queued ${queuedInputs.length} message${queuedInputs.length === 1 ? "" : "s"}`);
        }

        function processQueuedInput(): void {
            if (destroyed || processing()) return;
            const next = queuedInputs.shift();
            if (!next) return;
            showStatusNotice(queuedInputs.length > 0 ? `Sending queued message · ${queuedInputs.length} left` : "Sending queued message");
            void sendMessage(next);
        }

        function isAbortError(cause: unknown): boolean {
            return cause instanceof Error && cause.name === "AbortError";
        }

        // ── 退出处理 ──────────────────────────────────────────
        function handleExit(): void {
            if (processing()) {
                setError("Wait for the current turn to finish before exiting.");
                return;
            }
            if (inputRef && inputRef.plainText.length > 0) {
                inputRef.clear();
                setError("Input cleared. Type /exit to quit.");
                return;
            }
            setError("Type /exit to quit Flyflor chat.");
        }

        // ── 提交处理 ──────────────────────────────────────────
        function onSubmit() {
            if (!inputRef) return;
            const text = inputRef.plainText.trim();
            if (!text) return;
            const matchedCommand = matchAppCommand(appCommands, text);
            const matchedAction = matchedCommand ? builtinActionOf(matchedCommand.rule) : undefined;
            if (matchedAction === AppCommandAction.Clear) {
                batch(() => {
                    setMessages([]);
                    setError(null);
                    setCommandMenuMode(null);
                    historyOpen = false;
                    historyExhausted = false;
                    historyLoading = false;
                    oldestHistoryTs = undefined;
                    loadedHistoryEventIds.clear();
                    setBlackboardTurns({});
                    setFocusedBlackboardTurnId(null);
                    setActiveProject(null);
                    setActiveFork(null);
                    setProjectOptions([]);
                    setForkOptions([]);
                    setForkSources([]);
                    setSelectedProjectIndex(0);
                    setSelectedForkIndex(0);
                    setSelectedForkSourceIndex(0);
                });
                inputRef.clear();
                return;
            }
            if (matchedAction === AppCommandAction.History) {
                inputRef.clear();
                historyOpen = true;
                historyExhausted = false;
                historyLoading = false;
                oldestHistoryTs = undefined;
                loadedHistoryEventIds.clear();
                showStatusNotice("History mode opened");
                void loadOlderHistory("initial");
                return;
            }
            if (matchedAction === AppCommandAction.Bottom) {
                inputRef.clear();
                scrollToBottom();
                showStatusNotice("Jumped to latest");
                return;
            }
            if (matchedAction === AppCommandAction.Stop) {
                inputRef.clear();
                if (!stopCurrentTurn()) {
                    showStatusNotice("No active reply to stop");
                }
                return;
            }
            if (matchedAction === AppCommandAction.Continue) {
                inputRef.clear();
                void sendMessage(matchedCommand?.rule.prompt ?? "");
                return;
            }
            if (matchedAction === AppCommandAction.OpenThinking) {
                inputRef.clear();
                openQuestionMenu("thinking", text);
                return;
            }
            if (matchedAction === AppCommandAction.OpenBlackboard) {
                inputRef.clear();
                openQuestionMenu("blackboard", text);
                return;
            }
            if (matchedAction === AppCommandAction.Project) {
                inputRef.clear();
                void useProjectFromInput(text);
                return;
            }
            if (matchedAction === AppCommandAction.Projects) {
                inputRef.clear();
                void openProjectMenu();
                return;
            }
            if (matchedAction === AppCommandAction.Fork) {
                inputRef.clear();
                void openForkMenu(text);
                return;
            }
            if (matchedAction === AppCommandAction.Forks) {
                inputRef.clear();
                void openForkListMenu();
                return;
            }
            if (matchedAction === AppCommandAction.Exit) {
                destroyed = true;
                renderer.destroy();
                return;
            }
            if (matchedCommand?.rule.run.type === AppCommandRunType.SendMessage) {
                inputRef.clear();
                void sendMessage(matchedCommand.rule.run.prompt);
                return;
            }
            if (text.startsWith("/")) {
                setError(`Unknown command: ${text}. Press Tab to complete or use ${knownCommandList(appCommands)}.`);
                return;
            }
            inputRef.clear();
            setError(null);
            void sendMessage(text);
        }

        function selectQuestionFromCommand(text: string): void {
            const rawIndex = text.split(/\s+/u)[1];
            if (!rawIndex) return;
            const index = Number.parseInt(rawIndex, 10);
            if (!Number.isFinite(index)) return;
            setSelectedQuestionIndex(clamp(index - 1, 0, Math.max(0, turnPairs().length - 1)));
        }

        function openQuestionMenu(mode: SidePanelMode, text: string): void {
            setSidePanelMode(mode);
            const hasExplicitSelection = text.trim().split(/\s+/u).length > 1;
            selectQuestionFromCommand(text);
            const pairs = turnPairs();
            if (pairs.length === 0) {
                setCommandMenuMode(null);
                showStatusNotice(`/${mode} has no sent questions yet`);
                return;
            }
            if (selectedQuestionIndex() === null) {
                setSelectedQuestionIndex(pairs.length - 1);
            }
            setCommandMenuMode(hasExplicitSelection ? null : mode);
            showStatusNotice(
                hasExplicitSelection ? `Showing /${mode}` : `/${mode}: Up/Down choose a question, Enter open`,
            );
        }

        async function useProjectFromInput(text: string): Promise<void> {
            const raw = text.trim().split(/\s+/u).slice(1).join(" ").trim();
            const path = raw.length > 0 ? resolve(raw) : process.cwd();
            try {
                const project = await runtime.createOrUseProject({
                    path,
                    title: raw.length > 0 ? raw : undefined,
                    userId,
                    now: Date.now(),
                });
                setActiveProject(project);
                setSidePanelMode("projects");
                setProjectOptions((prev) => {
                    const next = [project, ...prev.filter((item) => item.id !== project.id)];
                    setSelectedProjectIndex(0);
                    return next;
                });
                showStatusNotice(`Project active: ${project.title}`);
            } catch (cause) {
                setError(`Project setup failed: ${describeError(cause)}`);
            }
        }

        async function openProjectMenu(): Promise<void> {
            const projects = runtime.listProjects(userId, { limit: 50 });
            setProjectOptions(projects);
            setSelectedProjectIndex(0);
            setCommandMenuMode("projects");
            setSidePanelMode("projects");
            if (projects.length === 0) {
                showStatusNotice("/projects has no saved projects yet");
            } else {
                showStatusNotice("/projects: Up/Down choose, Enter activate");
            }
        }

        async function openForkMenu(text: string, loadAll = false): Promise<void> {
            const turns = runtime.listChatHistory(userId, { limit: loadAll ? 200 : 20 });
            setForkSources(
                turns.map((turn) => ({
                    assistantText: turn.assistantText,
                    eventId: turn.eventId,
                    ts: turn.ts,
                    userText: turn.userText,
                })),
            );
            setSelectedForkSourceIndex(Math.max(0, turns.length - 1));
            setSidePanelMode("fork");
            setCommandMenuMode("fork");
            if (turns.length === 0) {
                showStatusNotice("/fork has no history yet");
                return;
            }
            const explicit = text.trim().split(/\s+/u).length > 1;
            showStatusNotice(explicit ? "Showing /fork source" : "/fork: Up/Down choose, a loads more, Enter fork");
        }

        async function openForkListMenu(): Promise<void> {
            const forks = runtime.listContextForks(userId, { limit: 50 });
            setForkOptions(forks);
            setSelectedForkIndex(0);
            setSidePanelMode("forks");
            setCommandMenuMode("forks");
            showStatusNotice(forks.length === 0 ? "/forks has no saved forks yet" : "/forks: Up/Down choose, Enter activate");
        }

        // ── 命令式 UI 树 ──────────────────────────────────────
        const root = renderer.root;

        // 主容器
        const mainBox = new BoxRenderable(renderer, {
            flexDirection: "column",
            width: renderer.width,
            height: renderer.height,
            backgroundColor: THEME.bg,
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
        });

        // Header
        const headerBox = new BoxRenderable(renderer, {
            flexDirection: "row",
            alignItems: "center",
            height: 2,
            paddingLeft: 1,
            paddingRight: 1,
            flexShrink: 0,
        });
        const brandText = new TextRenderable(renderer, {
            content: CHAT_HEADER_BRAND,
            fg: THEME.purple,
            selectable: false,
        });
        const headerSpacer = new BoxRenderable(renderer, {
            flexGrow: 1,
            flexShrink: 1,
        });
        const topStatusText = new TextRenderable(renderer, {
            content: "",
            fg: THEME.header,
            attributes: TextAttributes.BOLD,
            selectable: false,
        });
        headerBox.add(brandText);
        headerBox.add(headerSpacer);
        headerBox.add(topStatusText);
        mainBox.add(headerBox);

        // Error line
        const errorText = new TextRenderable(renderer, {
            content: "",
            fg: THEME.error,
        });
        errorText.visible = false;
        mainBox.add(errorText);

        const contentRow = new BoxRenderable(renderer, {
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            columnGap: 1,
        });
        mainBox.add(contentRow);

        const chatPane = new BoxRenderable(renderer, {
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            rowGap: 1,
        });
        contentRow.add(chatPane);

        const messagesRow = new BoxRenderable(renderer, {
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 1,
            border: true,
            borderColor: THEME.border,
            backgroundColor: THEME.panelBg,
            paddingLeft: 1,
            paddingRight: 0,
            paddingTop: 1,
            paddingBottom: 0,
        });
        chatPane.add(messagesRow);

        // Messages flow inside content; keep the ScrollBox root on its default row axis so the vertical bar stays right.
        const scrollBox = new ScrollBoxRenderable(renderer, {
            contentOptions: {
                flexDirection: "column",
                paddingRight: 1,
            },
            flexGrow: 1,
            flexShrink: 1,
            backgroundColor: THEME.panelBg,
            paddingLeft: 0,
            paddingRight: 0,
            stickyScroll: CHAT_SCROLL_LOCK_CONTRACT.chatStickyScroll,
            stickyStart: CHAT_SCROLL_LOCK_CONTRACT.chatStickyStart,
            horizontalScrollbarOptions: {
                height: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
            },
            verticalScrollbarOptions: {
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
                width: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                showArrows: false,
                trackOptions: {
                    backgroundColor: THEME.violetBg,
                    foregroundColor: THEME.pink,
                },
            },
        });
        useDetachedScrollBars(scrollBox);
        const messageVirtualScrollBar = createVirtualScrollBar(renderer, scrollBox, {
            thumbColor: THEME.pink,
            trackColor: THEME.border,
        });
        messagesRow.add(scrollBox);
        messagesRow.add(messageVirtualScrollBar.rail);

        // Input area
        const inputBox = new BoxRenderable(renderer, {
            flexDirection: "column",
            border: true,
            borderColor: THEME.border,
            backgroundColor: THEME.panelBg,
            flexShrink: 0,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 0,
        });
        const inputRow = new BoxRenderable(renderer, {
            flexDirection: "row",
            alignItems: "center",
            minHeight: 1,
        });
        const input = new TextareaRenderable(renderer, {
            placeholder: "Ask anything...",
            placeholderColor: THEME.fgMuted,
            backgroundColor: THEME.panelBg,
            focusedBackgroundColor: THEME.panelBg,
            textColor: THEME.fg,
            focusedTextColor: THEME.fg,
            cursorColor: THEME.fg,
            showCursor: true,
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 1,
            maxHeight: 6,
            wrapMode: "word",
            onContentChange: () => {
                setInputText(input.plainText);
            },
            keyBindings: [
                { name: "return", action: "submit" },
                { name: "linefeed", action: "submit" },
            ],
            onSubmit,
        });
        const sendIcon = new TextRenderable(renderer, {
            content: SEND_ICON_TEXT,
            fg: THEME.purple,
            attributes: TextAttributes.BOLD,
            selectable: false,
            width: 5,
        });
        inputRow.add(input);
        inputRow.add(sendIcon);
        inputBox.add(inputRow);
        inputRef = input;
        input.onSubmit = () => {
            onSubmit();
        };

        // Status bar
        const statusBox = new BoxRenderable(renderer, {
            backgroundColor: THEME.panelBg,
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
        });
        const statusText = new TextRenderable(renderer, {
            content: DEFAULT_STATUS_TEXT,
            fg: THEME.fgMuted,
            selectable: false,
            truncate: true,
            width: "100%",
        });
        statusBox.add(statusText);
        inputBox.add(statusBox);
        chatPane.add(inputBox);

        // 右侧栏只展示结构化运行态：路由分析、黑板讨论和 turn 进度。
        const sidePanel = new BoxRenderable(renderer, {
            flexDirection: "column",
            border: true,
            borderColor: THEME.border,
            backgroundColor: THEME.panelBg,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 1,
            flexShrink: 0,
            rowGap: 1,
            width: rightPanelWidth(renderer.width),
        });
        const sidePanelTitle = new TextRenderable(renderer, {
            content: "Blackboard   [Ctrl+B Thinking]",
            fg: THEME.fg,
            attributes: TextAttributes.BOLD,
            selectable: false,
            width: "100%",
        });
        const todoScrollBox = new ScrollBoxRenderable(renderer, {
            contentOptions: {
                flexDirection: "column",
                paddingRight: 1,
            },
            flexGrow: 1,
            flexShrink: 1,
            backgroundColor: THEME.panelBg,
            stickyScroll: CHAT_SCROLL_LOCK_CONTRACT.sidePanelStickyScroll,
            stickyStart: CHAT_SCROLL_LOCK_CONTRACT.sidePanelStickyStart,
            horizontalScrollbarOptions: {
                height: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
            },
            verticalScrollbarOptions: {
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
                width: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                showArrows: false,
                trackOptions: {
                    backgroundColor: THEME.violetBg,
                    foregroundColor: THEME.gold,
                },
            },
        });
        useDetachedScrollBars(todoScrollBox);
        const todoVirtualScrollBar = createVirtualScrollBar(renderer, todoScrollBox, {
            thumbColor: THEME.gold,
            trackColor: THEME.border,
        });

        const detailScrollBox = new ScrollBoxRenderable(renderer, {
            contentOptions: {
                flexDirection: "column",
                paddingRight: 1,
            },
            flexGrow: 1,
            flexShrink: 1,
            backgroundColor: THEME.panelBg,
            stickyScroll: CHAT_SCROLL_LOCK_CONTRACT.sidePanelStickyScroll,
            stickyStart: CHAT_SCROLL_LOCK_CONTRACT.sidePanelStickyStart,
            horizontalScrollbarOptions: {
                height: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
            },
            verticalScrollbarOptions: {
                visible: CHAT_SCROLL_LOCK_CONTRACT.showScrollbars,
                width: CHAT_SCROLL_LOCK_CONTRACT.hiddenScrollbarSize,
                showArrows: false,
                trackOptions: {
                    backgroundColor: THEME.violetBg,
                    foregroundColor: THEME.pink,
                },
            },
        });
        useDetachedScrollBars(detailScrollBox);
        const detailVirtualScrollBar = createVirtualScrollBar(renderer, detailScrollBox, {
            thumbColor: THEME.pink,
            trackColor: THEME.border,
        });

        const metricsCard = new BoxRenderable(renderer, {
            flexDirection: "column",
            flexShrink: 0,
            height: metricsPanelHeight(renderer.height),
            border: ["top"],
            borderColor: THEME.border,
            backgroundColor: THEME.panelBg,
            paddingTop: 1,
        });
        const metricsContent = new BoxRenderable(renderer, {
            flexDirection: "column",
            width: "100%",
        });
        metricsCard.add(metricsContent);

        const todoCard = new BoxRenderable(renderer, {
            flexDirection: "column",
            flexShrink: 0,
            height: todoPanelHeight(renderer.height),
            border: ["top"],
            borderColor: THEME.border,
            backgroundColor: THEME.panelBg,
            paddingTop: 1,
        });
        const detailCard = new BoxRenderable(renderer, {
            flexDirection: "column",
            flexGrow: 1,
            flexShrink: 1,
            backgroundColor: THEME.panelBg,
        });
        const todoScrollRow = new BoxRenderable(renderer, {
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 1,
        });
        todoScrollRow.add(todoScrollBox);
        todoScrollRow.add(todoVirtualScrollBar.rail);
        const detailScrollRow = new BoxRenderable(renderer, {
            flexDirection: "row",
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 1,
        });
        detailScrollRow.add(detailScrollBox);
        detailScrollRow.add(detailVirtualScrollBar.rail);
        todoCard.add(todoScrollRow);
        detailCard.add(detailScrollRow);
        sidePanel.add(sidePanelTitle);
        sidePanel.add(detailCard);
        sidePanel.add(todoCard);
        sidePanel.add(metricsCard);
        contentRow.add(sidePanel);

        root.add(mainBox);

        function isWithin(renderable: Renderable | undefined, container: Renderable): boolean {
            let current: Renderable | null | undefined = renderable;
            while (current) {
                if (current === container) return true;
                current = current.parent;
            }
            return false;
        }

        function setSelectableDeep(renderable: Renderable, selectable: boolean): void {
            renderable.selectable = selectable;
            for (const child of renderable.getChildren()) {
                setSelectableDeep(child, selectable);
            }
        }

        function applySelectionScope(scope: SelectionScope): void {
            selectionScope = scope;
            setSelectableDeep(scrollBox.content, scope !== "side");
            setSelectableDeep(sidePanel, scope !== "chat");
        }

        function scopeForRenderable(renderable: Renderable | undefined): SelectionScope {
            if (isWithin(renderable, sidePanel)) return "side";
            if (isWithin(renderable, scrollBox.content)) return "chat";
            return null;
        }

        if (originalStartSelection) {
            // OpenTUI expands a drag selection to parent containers when the pointer leaves
            // the starting renderable. Locking the non-origin panel out before selection starts
            // keeps copied text inside the panel where the drag began.
            selectionRenderer.startSelection = (renderable, x, y) => {
                applySelectionScope(scopeForRenderable(renderable));
                suppressSelectionReset = true;
                try {
                    originalStartSelection(renderable, x, y);
                    pruneSelectionToScope();
                } finally {
                    suppressSelectionReset = false;
                }
            };
        }
        selectionRenderer.updateSelection = (renderable, x, y, options) => {
            const nextScope = scopeForRenderable(renderable);
            const scopedRenderable =
                selectionScope && nextScope && nextScope !== selectionScope ? undefined : renderable;
            originalUpdateSelection(scopedRenderable, x, y, options);
            pruneSelectionToScope();
        };
        selectionRenderer.clearSelection = () => {
            originalClearSelection();
            if (!suppressSelectionReset && selectionScope !== null) {
                applySelectionScope(null);
            }
        };

        // Wire input events directly
        input.focus();
        renderer.requestRender();
        input.showCursor = true;
        input.cursorColor = THEME.fg;
        input.cursorStyle = { style: "line", blinking: true };
        const resizeHandler = () => {
            mainBox.width = renderer.width;
            mainBox.height = renderer.height;
            sidePanel.width = rightPanelWidth(renderer.width);
            metricsCard.height = metricsPanelHeight(renderer.height);
            todoCard.height = todoPanelHeight(renderer.height);
        };
        renderer.on(CliRenderEvents.RESIZE, resizeHandler);
        historyPollTimer = setInterval(() => {
            if (destroyed) return;
            if (!historyOpen || historyLoading || historyExhausted) return;
            if (scrollBox.scrollTop <= 1 && messages().length > 0) {
                void loadOlderHistory("scroll");
            }
        }, 250);

        // Keyboard handler
        const keyHandler = (event: {
            name?: string;
            ctrl?: boolean;
            meta?: boolean;
            preventDefault?: () => void;
            shift?: boolean;
            stopPropagation?: () => void;
            sequence?: string;
        }) => {
            const isMac = process.platform === "darwin";
            const name = event.name ?? "";
            if (((isMac && event.meta) || (!isMac && event.ctrl)) && name === "c") {
                if (copySelectionToClipboard()) {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    return;
                }
                if (!isMac && event.ctrl && inputRef?.focused) {
                    handleExit();
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    return;
                }
            }
            if ((event.ctrl && event.shift && name === "c") || (event.ctrl && name === "y")) {
                if (copySelectionToClipboard()) {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                    return;
                }
            }
            if (handleSideMenuKey(name, event.sequence)) {
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (name === "tab" && completeCommandInput()) {
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (name === "pageup" || event.sequence === "\u001b[5~") {
                scrollMessages(-1);
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (name === "pagedown" || event.sequence === "\u001b[6~") {
                scrollMessages(1);
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (name === "home" || event.sequence === "\u001b[H" || event.sequence === "\u001b[1~") {
                scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: 0 });
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (name === "end" || event.sequence === "\u001b[F" || event.sequence === "\u001b[4~") {
                scrollToBottom();
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (event.ctrl && name === "b") {
                setSidePanelMode(sidePanelMode() === "blackboard" ? "thinking" : "blackboard");
                setCommandMenuMode(null);
                event.preventDefault?.();
                event.stopPropagation?.();
                return;
            }
            if (
                inputRef?.focused &&
                (name === "return" ||
                    name === "enter" ||
                    name === "linefeed" ||
                    event.sequence === "\n" ||
                    event.sequence === "\r")
            ) {
                event.preventDefault?.();
                event.stopPropagation?.();
                onSubmit();
            }
        };
        renderer.keyInput.on("keypress", keyHandler);

        function handleSideMenuKey(name: string, sequence?: string): boolean {
            const mode = commandMenuMode();
            if (!mode) return false;
            if (mode === "blackboard" || mode === "thinking") {
                const pairs = turnPairs();
                if (pairs.length === 0) {
                    setCommandMenuMode(null);
                    return false;
                }
                const selected = selectedQuestionIndex() ?? pairs.length - 1;
                if (name === "up" || name === "k" || sequence === "\u001b[A") {
                    setSelectedQuestionIndex(clamp(selected - 1, 0, pairs.length - 1));
                    return true;
                }
                if (name === "down" || name === "j" || sequence === "\u001b[B") {
                    setSelectedQuestionIndex(clamp(selected + 1, 0, pairs.length - 1));
                    return true;
                }
                if (
                    name === "return" ||
                    name === "enter" ||
                    name === "linefeed" ||
                    name === "right" ||
                    name === "o" ||
                    sequence === "\n" ||
                    sequence === "\r" ||
                    sequence === "\u001b[C"
                ) {
                    setCommandMenuMode(null);
                    showStatusNotice(`Showing /${mode} for selected question`);
                    return true;
                }
                if (name === "escape" || sequence === "\u001b") {
                    setCommandMenuMode(null);
                    showStatusNotice("Question menu closed");
                    return true;
                }
                return false;
            }
            if (mode === "projects") {
                const projects = projectOptions();
                if (projects.length === 0) {
                    setCommandMenuMode(null);
                    return false;
                }
                const selected = selectedProjectIndex();
                if (name === "up" || name === "k" || sequence === "\u001b[A") {
                    setSelectedProjectIndex(clamp(selected - 1, 0, projects.length - 1));
                    return true;
                }
                if (name === "down" || name === "j" || sequence === "\u001b[B") {
                    setSelectedProjectIndex(clamp(selected + 1, 0, projects.length - 1));
                    return true;
                }
                if (name === "escape" || sequence === "\u001b") {
                    setCommandMenuMode(null);
                    showStatusNotice("Project picker closed");
                    return true;
                }
                if (
                    name === "return" ||
                    name === "enter" ||
                    name === "linefeed" ||
                    sequence === "\n" ||
                    sequence === "\r"
                ) {
                    const project = projects[clamp(selected, 0, projects.length - 1)];
                    if (project) {
                        setActiveProject(project);
                        showStatusNotice(`Project active: ${project.title}`);
                    }
                    setCommandMenuMode(null);
                    return true;
                }
                return false;
            }
            if (mode === "fork") {
                const sources = forkSources();
                if (sources.length === 0) {
                    setCommandMenuMode(null);
                    return false;
                }
                const selected = selectedForkSourceIndex();
                if (name === "a") {
                    void openForkMenu("/fork all", true);
                    return true;
                }
                if (name === "up" || name === "k" || sequence === "\u001b[A") {
                    setSelectedForkSourceIndex(clamp(selected - 1, 0, sources.length - 1));
                    return true;
                }
                if (name === "down" || name === "j" || sequence === "\u001b[B") {
                    setSelectedForkSourceIndex(clamp(selected + 1, 0, sources.length - 1));
                    return true;
                }
                if (name === "escape" || sequence === "\u001b") {
                    setCommandMenuMode(null);
                    showStatusNotice("Fork picker closed");
                    return true;
                }
                if (
                    name === "return" ||
                    name === "enter" ||
                    name === "linefeed" ||
                    sequence === "\n" ||
                    sequence === "\r"
                ) {
                    const source = sources[clamp(selected, 0, sources.length - 1)];
                    if (source) {
                        void activateForkFromSource(source);
                    }
                    setCommandMenuMode(null);
                    return true;
                }
                return false;
            }
            if (mode === "forks") {
                const forks = forkOptions();
                if (forks.length === 0) {
                    setCommandMenuMode(null);
                    return false;
                }
                const selected = selectedForkIndex();
                if (name === "up" || name === "k" || sequence === "\u001b[A") {
                    setSelectedForkIndex(clamp(selected - 1, 0, forks.length - 1));
                    return true;
                }
                if (name === "down" || name === "j" || sequence === "\u001b[B") {
                    setSelectedForkIndex(clamp(selected + 1, 0, forks.length - 1));
                    return true;
                }
                if (name === "escape" || sequence === "\u001b") {
                    setCommandMenuMode(null);
                    showStatusNotice("Fork list closed");
                    return true;
                }
                if (
                    name === "return" ||
                    name === "enter" ||
                    name === "linefeed" ||
                    sequence === "\n" ||
                    sequence === "\r"
                ) {
                    const fork = forks[clamp(selected, 0, forks.length - 1)];
                    if (fork) {
                        setActiveFork(fork);
                        showStatusNotice(`Fork active: ${fork.title}`);
                    }
                    setCommandMenuMode(null);
                    return true;
                }
                return false;
            }
            return false;
        }

        async function activateForkFromSource(source: ForkHistorySource): Promise<void> {
            try {
                const fork = await runtime.createContextFork(
                    {
                        id: `fork-${source.eventId}`,
                        userId,
                        title: clipText(source.userText, 60),
                        summary: clipText(`${source.userText} / ${source.assistantText}`, 160),
                        scopeSummary: clipText(source.assistantText || source.userText, 180),
                        maxContextTokens: 4096,
                        inheritedEventIds: [source.eventId],
                        createdAt: new Date(source.ts).toISOString(),
                        updatedAt: new Date().toISOString(),
                        sourceEventId: source.eventId,
                    },
                    {
                        assistantText: source.assistantText,
                        eventId: source.eventId,
                        userText: source.userText,
                    },
                );
                setActiveFork(fork);
                setForkOptions((prev) => [fork, ...prev.filter((item) => item.id !== fork.id)]);
                showStatusNotice(`Fork active: ${fork.title}`);
            } catch (cause) {
                setError(`Fork setup failed: ${describeError(cause)}`);
            }
        }

        function scrollMessages(direction: -1 | 1): void {
            const page = Math.max(4, scrollBox.viewport.height - 2);
            scrollBox.scrollBy({ x: 0, y: direction * page });
        }

        function scrollToBottom(): void {
            scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: scrollBox.scrollHeight });
        }

        function completeCommandInput(): boolean {
            if (!inputRef) return false;
            const text = inputRef.plainText.trim();
            if (!text.startsWith("/")) return false;
            const matches = commandSuggestions(text);
            const selected = matches[0];
            if (!selected) return false;
            inputRef.clear();
            inputRef.insertText(selected.name);
            setInputText(selected.name);
            showStatusNotice(`${selected.name} — ${selected.detail}`);
            return true;
        }

        function commandSuggestions(prefix: string): AppCommandSuggestion[] {
            return appCommandSuggestions(appCommands, prefix);
        }

        const selectionHandler = () => {
            const text = renderer.getSelection()?.getSelectedText() ?? "";
            if (text.trim().length > 0) {
                showStatusNotice(`${text.length} chars selected`);
            }
        };
        renderer.on(CliRenderEvents.SELECTION, selectionHandler);

        // ── 辅助：构建单条消息的 renderables ──────────────────
        function buildMessageBox(msg: ChatMessage): MsgRenderable {
            const box = new BoxRenderable(renderer, {
                flexDirection: "column",
                paddingTop: 1,
                paddingBottom: 1,
                paddingLeft: 1,
                paddingRight: 1,
            });

            const roleText = new TextRenderable(renderer, {
                content: `${msg.role === "user" ? "You" : agentName}${msg.history ? " · history" : ""}`,
                fg: msg.role === "user" ? THEME.user : THEME.assistant,
                attributes: TextAttributes.BOLD,
                selectable: true,
            });
            box.add(roleText);

            const contentBox = new BoxRenderable(renderer, {
                flexDirection: "column",
                width: "100%",
            });
            const contentRenderable = createMessageContentRenderable(msg);
            contentBox.add(contentRenderable);
            box.add(contentBox);

            const extraBox = buildExtras(msg);
            if (extraBox) {
                box.add(extraBox);
            }

            return {
                id: msg.id,
                box,
                contentBox,
                contentKey: messageContentKey(msg),
                contentRenderable,
                extrasKey: messageExtrasKey(msg),
                extraBox,
            };
        }

        function createMessageContentRenderable(msg: ChatMessage): TextRenderable | MarkdownRenderable {
            if (msg.role === "assistant") {
                // Let OpenTUI own markdown parsing so tables, rules, code blocks, and links stay intact.
                return new MarkdownRenderable(renderer, {
                    content: msg.content,
                    syntaxStyle: markdownSyntaxStyle,
                    fg: THEME.assistant,
                    bg: THEME.bg,
                    width: "100%",
                    conceal: true,
                    concealCode: false,
                    streaming: msg.status === "streaming",
                    internalBlockMode: "top-level",
                    tableOptions: {
                        style: "grid",
                        widthMode: "full",
                        wrapMode: "word",
                        cellPaddingX: 1,
                        cellPaddingY: 0,
                        selectable: true,
                        borders: true,
                        outerBorder: true,
                        borderColor: THEME.border,
                    },
                });
            }

            return new TextRenderable(renderer, {
                content: msg.content,
                fg: THEME.fg,
                selectable: true,
                width: "100%",
                wrapMode: "word",
            });
        }

        function messageContentKey(msg: ChatMessage): string {
            return `${msg.role}:${msg.status}:${msg.content}`;
        }

        function updateMessageContent(renderable: MsgRenderable, msg: ChatMessage): void {
            const nextKey = messageContentKey(msg);
            const nextIsMarkdown = msg.role === "assistant";
            if (renderable.contentKey === nextKey && (renderable.contentRenderable instanceof MarkdownRenderable) === nextIsMarkdown) {
                return;
            }
            if (nextIsMarkdown && renderable.contentRenderable instanceof MarkdownRenderable) {
                renderable.contentRenderable.content = msg.content;
                renderable.contentRenderable.streaming = msg.status === "streaming";
                renderable.contentKey = nextKey;
                return;
            }
            if (!nextIsMarkdown && renderable.contentRenderable instanceof TextRenderable) {
                renderable.contentRenderable.content = msg.content;
                renderable.contentKey = nextKey;
                return;
            }

            renderable.contentBox.remove(renderable.contentRenderable.id);
            renderable.contentRenderable.destroy();
            renderable.contentRenderable = createMessageContentRenderable(msg);
            renderable.contentBox.add(renderable.contentRenderable);
            renderable.contentKey = nextKey;
        }

        function messageExtrasKey(msg: ChatMessage): string {
            return JSON.stringify({
                ask: msg.ask ?? null,
                mcpCalls: msg.mcpCalls ?? [],
                phase: msg.status === "streaming" && !msg.content ? phase() : undefined,
                planning: msg.planning ?? null,
                skills: msg.skills ?? [],
                status: msg.status,
                tick: msg.status === "streaming" && !msg.content ? frameTick() : undefined,
            });
        }

        function buildExtras(msg: ChatMessage): BoxRenderable | undefined {
            const extras: TextRenderable[] = [];

            if (msg.status === "streaming" && !msg.content) {
                const ph = phase();
                const def = PHASE_DEF[ph];
                const frame = def.frames[frameTick() % def.frames.length] ?? def.done;
                extras.push(
                    new TextRenderable(renderer, {
                        content: `${frame} ${def.label}...`,
                        fg: def.color,
                        selectable: true,
                    }),
                );
            }

            if (msg.mcpCalls && msg.mcpCalls.length > 0) {
                for (const call of msg.mcpCalls) {
                    const icon = call.ok ? "ok" : "fail";
                    const color = call.ok ? THEME.user : THEME.error;
                    extras.push(
                        new TextRenderable(renderer, {
                            content: `  ${icon} ${call.server}.${call.tool}`,
                            fg: color,
                            selectable: true,
                        }),
                    );
                    if (call.resultText) {
                        extras.push(
                            new TextRenderable(renderer, {
                                content: `    ${clipText(call.resultText, 120)}`,
                                fg: THEME.fgMuted,
                                selectable: true,
                            }),
                        );
                    }
                }
            }

            if (msg.skills && msg.skills.length > 0) {
                extras.push(
                    new TextRenderable(renderer, {
                        content: `  skills: ${msg.skills.join(", ")}`,
                        fg: THEME.pink,
                        selectable: true,
                    }),
                );
            }

            if (msg.ask) {
                const ask = msg.ask;
                const detail = [
                    ask.reason ? `reason=${ask.reason}` : undefined,
                    ask.questionCount !== undefined ? `questions=${ask.questionCount}` : undefined,
                    ask.choiceCount !== undefined ? `choices=${ask.choiceCount}` : undefined,
                    ask.snapshotId ? `snapshot=${ask.snapshotId}` : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                extras.push(
                    new TextRenderable(renderer, {
                        content: `  ask: ${detail}`,
                        fg: THEME.pink,
                        selectable: true,
                    }),
                );
                for (const line of formatAskSummaryLines(ask)) {
                    extras.push(extraLine(line, THEME.pink));
                }
            }

            if (msg.planning?.taskPlans && msg.planning.taskPlans.length > 0) {
                for (const plan of msg.planning.taskPlans.slice(0, 2)) {
                    extras.push(
                        new TextRenderable(renderer, {
                            content: `  todo: ${plan.title} · ${plan.status} · ${Math.round(plan.progress * 100)}%`,
                            fg: THEME.header,
                            selectable: true,
                        }),
                    );
                }
            }

            if (msg.planning?.contextForks && msg.planning.contextForks.length > 0) {
                for (const fork of msg.planning.contextForks.slice(0, 2)) {
                    extras.push(extraLine(`  fork: ${fork.title} · budget=${fork.maxContextTokens}`, THEME.purple));
                }
            }

            if (extras.length === 0) return undefined;
            const box = new BoxRenderable(renderer, { flexDirection: "column" });
            for (const t of extras) box.add(t);
            return box;
        }

        function blackboardTurnFor(msg: ChatMessage): BlackboardTurn | undefined {
            if (msg.blackboardTurn) return msg.blackboardTurn;
            const turnId = msg.blackboard?.turnId;
            return turnId ? blackboardTurns()[turnId] : undefined;
        }

        function activeReply(): ChatMessage | undefined {
            const selected = selectedTurnPair();
            if (selected?.assistant) return selected.assistant;
            const id = activeReplyId();
            if (id) {
                const active = messages().find((msg) => msg.id === id);
                if (active) return active;
            }
            return [...messages()].reverse().find((msg) => msg.role === "assistant" && !msg.history);
        }

        function focusedBlackboardTurn(): BlackboardTurn | undefined {
            const selected = selectedTurnPair();
            if (selected?.assistant) {
                const turn = blackboardTurnFor(selected.assistant);
                if (turn) return turn;
            }
            const turnId = focusedBlackboardTurnId();
            if (turnId) {
                const turn = blackboardTurns()[turnId];
                if (turn) return turn;
            }
            const msg = [...messages()]
                .reverse()
                .find((entry) => entry.role === "assistant" && entry.blackboard?.turnId);
            return msg ? blackboardTurnFor(msg) : undefined;
        }

        function turnPairs(): Array<{ assistant?: ChatMessage; question: string; user: ChatMessage }> {
            const out: Array<{ assistant?: ChatMessage; question: string; user: ChatMessage }> = [];
            const msgs = messages();
            for (let i = 0; i < msgs.length; i += 1) {
                const msg = msgs[i];
                if (!msg || msg.role !== "user" || msg.history) continue;
                const assistant = msgs.slice(i + 1).find((entry) => entry.role === "assistant" && !entry.history);
                out.push({ assistant, question: msg.content, user: msg });
            }
            return out;
        }

        function selectedTurnPair(): { assistant?: ChatMessage; question: string; user: ChatMessage } | undefined {
            const pairs = turnPairs();
            if (pairs.length === 0) return undefined;
            const selected = selectedQuestionIndex();
            if (selected === null) return pairs[pairs.length - 1];
            return pairs[clamp(selected, 0, pairs.length - 1)];
        }

        function resourcePanelLines(): PanelLine[] {
            const pair = selectedTurnPair();
            const snapshot = buildChatResourceSnapshot({
                activeFork: activeFork(),
                activeProject: activeProject(),
                draftText: inputText(),
                maxOutputTokens: resourceConfig.maxOutputTokens,
                contextPressureBudgetTokens: resourceConfig.contextPressureBudgetTokens,
                contextRingSize: resourceConfig.contextRingSize,
                identityAppendDailyLimit: resourceConfig.identityAppendDailyLimit,
                memoryVisibilityThreshold: resourceConfig.memoryVisibilityThreshold,
                model: resourceConfig.model,
                providerId: resourceConfig.providerId,
                questionText: pair?.question,
                reply: activeReply(),
                turnCount: turnPairs().length,
            });
            const lines = [
                panelLine("LLM / Context", THEME.header, TextAttributes.BOLD),
                panelLine(`  ${snapshot.modelLine}`, THEME.fg),
            ];
            const visibleMetrics = metricsPanelHeight(renderer.height) <= METRICS_PANEL_MIN_HEIGHT
                ? snapshot.metrics.slice(0, 3)
                : snapshot.metrics;
            for (const metric of visibleMetrics) {
                lines.push(panelLine(`  ${metric.label.padEnd(7)} ${metric.bar} ${metric.value}`, metric.color));
            }
            lines.push(panelLine(`  memory ${snapshot.memoryLine}`, THEME.fgMuted));
            return lines;
        }

        function todoPanelLines(): PanelLine[] {
            const lines: PanelLine[] = [];
            appendTodoSection(lines, activeReply(), focusedBlackboardTurn());
            return lines;
        }

        function detailPanelLines(): PanelLine[] {
            const lines: PanelLine[] = [];
            const turn = focusedBlackboardTurn();
            appendScopeSummary(lines);
            if (sidePanelMode() === "projects") {
                appendProjectPickerLines(lines);
                return lines;
            }
            if (sidePanelMode() === "fork") {
                appendForkSourceLines(lines);
                return lines;
            }
            if (sidePanelMode() === "forks") {
                appendForkListLines(lines);
                return lines;
            }
            appendDetailModeHeader(lines);
            appendConversationSummary(lines);
            lines.push(panelLine("", THEME.fg));
            if (sidePanelMode() === "thinking") {
                appendThinkingDetail(lines, turn);
            } else {
                appendBlackboardDetail(lines, turn);
            }
            return lines;
        }

        function appendDetailModeHeader(lines: PanelLine[]): void {
            const thinkingActive = sidePanelMode() === "thinking";
            lines.push(panelLine("Detail Panel  Ctrl+B", THEME.gold, TextAttributes.BOLD));
            lines.push(
                panelLine(
                    `  ${thinkingActive ? ">" : " "} 深度思考    ${thinkingActive ? " " : ">"} 黑板详情`,
                    thinkingActive ? THEME.header : THEME.purple,
                ),
            );
        }

        function appendScopeSummary(lines: PanelLine[]): void {
            const project = activeProject();
            const fork = activeFork();
            lines.push(panelLine("Scope", THEME.header, TextAttributes.BOLD));
            lines.push(
                panelLine(
                    `  project: ${project ? project.title : "none"} · fork: ${fork ? fork.title : "none"}`,
                    THEME.fg,
                ),
            );
            if (project) {
                lines.push(panelLine(`  dir: ${clipText(project.projectDir, 96)}`, THEME.fgMuted));
            }
            if (fork) {
                lines.push(panelLine(`  fork scope: ${clipText(fork.scopeSummary, 96)}`, THEME.fgMuted));
            }
        }

        function appendConversationSummary(lines: PanelLine[]): void {
            const pairs = turnPairs();
            const selected = selectedTurnPair();
            const menuOpen = commandMenuMode() === sidePanelMode();
            lines.push(
                panelLine(
                    menuOpen ? "Conversation Summary  ↑/↓ Enter" : "Conversation Summary",
                    THEME.header,
                    TextAttributes.BOLD,
                ),
            );
            if (pairs.length === 0) {
                lines.push(panelLine("  no conversation turns yet", THEME.fgMuted));
                return;
            }
            lines.push(
                panelLine(
                    "  select a turn to preview its thinking / blackboard",
                    THEME.fgMuted,
                ),
            );
            const visibleCount = menuOpen ? 12 : 8;
            pairs.slice(-visibleCount).forEach((pair, idx) => {
                const absoluteIndex = pairs.length - Math.min(visibleCount, pairs.length) + idx;
                const active = pair.user.id === selected?.user.id;
                const status = pair.assistant?.status ?? "pending";
                lines.push(
                    panelLine(
                        `${active ? ">" : " "} ${summarizeQuestion(pair.question, absoluteIndex + 1, menuOpen ? 36 : 32)} · ${status}`,
                        active ? THEME.pink : THEME.fgMuted,
                        active ? TextAttributes.BOLD : undefined,
                    ),
                );
            });
        }

        function appendTodoSection(lines: PanelLine[], msg: ChatMessage | undefined, turn: BlackboardTurn | undefined): void {
            lines.push(panelLine("Todo / Progress", THEME.header, TextAttributes.BOLD));
            const plans = msg?.planning?.taskPlans ?? [];
            if (plans.length > 0) {
                for (const plan of plans.slice(0, 3)) {
                    lines.push(
                        panelLine(
                            `  ${plan.title} · ${plan.status} · ${Math.round(plan.progress * 100)}%`,
                            THEME.fg,
                        ),
                    );
                    for (const step of (plan.steps ?? []).slice(0, 5)) {
                        lines.push(panelLine(`    ${step.status} ${step.title}`, THEME.purple));
                    }
                }
                return;
            }
            if (!turn) {
                lines.push(panelLine(`  ${NO_PLAN_TEXT}`, THEME.fgMuted));
                return;
            }
            const snapshot = buildChatTodoSnapshot(turn);
            if (snapshot.stepCount === 0 && snapshot.workstreamCount === 0) {
                lines.push(panelLine(`  ${NO_PLAN_TEXT}`, THEME.fgMuted));
                if (snapshot.workerLine) {
                    lines.push(panelLine(`  ${snapshot.workerLine}`, THEME.fgMuted));
                }
                return;
            }
            lines.push(panelLine(`  ${snapshot.progressLine}`, THEME.fg));
            if (snapshot.workerLine) {
                lines.push(panelLine(`  ${snapshot.workerLine}`, THEME.fgMuted));
            }
            if (snapshot.workstreams.length > 0) {
                lines.push(panelLine("  workstreams", THEME.fgMuted));
                for (const item of snapshot.workstreams) {
                    lines.push(panelLine(`    ${item}`, THEME.fg));
                }
            }
            if (snapshot.steps.length > 0) {
                lines.push(panelLine("  steps", THEME.fgMuted));
                for (const item of snapshot.steps) {
                    lines.push(panelLine(`    ${item}`, THEME.purple));
                }
            }
        }

        function appendThinkingDetail(lines: PanelLine[], turn: BlackboardTurn | undefined): void {
            const msg = activeReply();
            const ph = phase();
            const def = PHASE_DEF[ph];
            const running = processing();
            const frame = running ? (def.frames[frameTick() % def.frames.length] ?? def.done) : def.done;
            lines.push(panelLine("Thinking", THEME.header, TextAttributes.BOLD));
            lines.push(panelLine(`${frame} ${running ? def.label : "ready"}`, running ? def.color : THEME.fgMuted));
            if (turn) {
                appendBlackboardRouteLines(lines, turn);
                appendBlackboardStatusLines(lines, turn, 4);
            } else {
                appendSceneReplayLines(lines, msg);
            }
            appendReplySummaryLines(lines, msg);
        }

        function appendBlackboardDetail(lines: PanelLine[], turn: BlackboardTurn | undefined): void {
            if (!turn) {
                lines.push(panelLine("Blackboard", THEME.purple, TextAttributes.BOLD));
                appendSceneReplayLines(lines, activeReply());
                return;
            }
            appendBlackboardRouteLines(lines, turn);
            appendBlackboardPanelLines(lines, turn);
        }

        function appendSceneReplayLines(lines: PanelLine[], msg: ChatMessage | undefined): void {
            const scenes = msg?.planning?.scenes ?? [];
            if (scenes.length === 0) {
                lines.push(panelLine("  no replay summary yet", THEME.fgMuted));
                return;
            }
            lines.push(panelLine("Scene Replay", THEME.purple, TextAttributes.BOLD));
            for (const scene of scenes.slice(0, 5)) {
                lines.push(panelLine(`  ${scene.kind}: ${scene.title}`, THEME.purple));
                lines.push(panelLine(`    ${clipText(scene.summary, 120)}`, THEME.fgMuted));
                if (scene.detail) {
                    lines.push(panelLine(`    ${clipText(scene.detail, 180)}`, THEME.fgMuted));
                }
            }
        }

        function appendReplySummaryLines(lines: PanelLine[], msg: ChatMessage | undefined): void {
            if (msg?.skills && msg.skills.length > 0) {
                lines.push(panelLine("Skills", THEME.pink, TextAttributes.BOLD));
                for (const skill of msg.skills) {
                    lines.push(panelLine(`  ${skill}`, THEME.fg));
                }
            }

            if (msg?.mcpCalls && msg.mcpCalls.length > 0) {
                lines.push(panelLine("MCP", THEME.user, TextAttributes.BOLD));
                for (const call of msg.mcpCalls.slice(-8)) {
                    lines.push(
                        panelLine(
                            `  ${call.ok ? "ok" : "fail"} ${call.server}.${call.tool}`,
                            call.ok ? THEME.fg : THEME.error,
                        ),
                    );
                    if (call.resultText) {
                        lines.push(panelLine(`    ${clipText(call.resultText, 96)}`, THEME.fgMuted));
                    }
                }
            }

            if (!msg) {
                lines.push(panelLine("Reply", THEME.header, TextAttributes.BOLD));
                lines.push(panelLine("  no active reply yet", THEME.fgMuted));
                return;
            }

            lines.push(panelLine("Reply", THEME.header, TextAttributes.BOLD));
            lines.push(panelLine(`  ${msg.status}${msg.content ? ` · ${msg.content.length} chars` : ""}`, THEME.fg));
        }

        function appendBlackboardStatusLines(lines: PanelLine[], turn: BlackboardTurn, recentCount: number): void {
            lines.push(panelLine("Discussion", THEME.purple, TextAttributes.BOLD));
            const recentSteps = turn.steps.slice(-recentCount);
            if (recentSteps.length === 0) {
                lines.push(panelLine("  waiting for worker output", THEME.fgMuted));
                return;
            }
            for (const step of recentSteps) {
                lines.push(
                    panelLine(
                        `  r${step.round} ${step.workerRole}: ${clipText(step.outputSummary, 110)}`,
                        THEME.purple,
                    ),
                );
            }
        }

        function appendProjectPickerLines(lines: PanelLine[]): void {
            const projects = projectOptions();
            if (projects.length === 0) {
                lines.push(panelLine("  no saved projects", THEME.fgMuted));
                return;
            }
            lines.push(panelLine("Project Picker", THEME.purple, TextAttributes.BOLD));
            for (const [idx, project] of projects.entries()) {
                const active = idx === selectedProjectIndex();
                lines.push(
                    panelLine(
                        `  ${active ? ">" : " "} ${project.title} · ${clipText(project.projectDir, 64)}`,
                        active ? THEME.pink : THEME.fg,
                    ),
                );
            }
        }

        function appendForkSourceLines(lines: PanelLine[]): void {
            const sources = forkSources();
            if (sources.length === 0) {
                lines.push(panelLine("  no history turns", THEME.fgMuted));
                return;
            }
            lines.push(panelLine("Fork Source History", THEME.purple, TextAttributes.BOLD));
            for (const [idx, source] of sources.entries()) {
                const active = idx === selectedForkSourceIndex();
                lines.push(
                    panelLine(
                        `  ${active ? ">" : " "} ${clipText(source.userText, 30)} → ${clipText(source.assistantText, 42)}`,
                        active ? THEME.pink : THEME.fg,
                    ),
                );
            }
        }

        function appendForkListLines(lines: PanelLine[]): void {
            const forks = forkOptions();
            if (forks.length === 0) {
                lines.push(panelLine("  no saved forks", THEME.fgMuted));
                return;
            }
            lines.push(panelLine("Fork Picker", THEME.purple, TextAttributes.BOLD));
            for (const [idx, fork] of forks.entries()) {
                const active = idx === selectedForkIndex();
                lines.push(
                    panelLine(
                        `  ${active ? ">" : " "} ${fork.title} · ${Math.round(fork.maxContextTokens)} tokens`,
                        active ? THEME.pink : THEME.fg,
                    ),
                );
                lines.push(panelLine(`    ${clipText(fork.summary, 88)}`, THEME.fgMuted));
            }
        }

        function appendBlackboardRouteLines(lines: PanelLine[], turn: BlackboardTurn): void {
            const metadata = readRecord(turn.metadata);
            const routeReason = stringValue(metadata?.routeReason);
            const routeScore = numberValue(metadata?.routeScore);
            const routeSignals = readStringArray(metadata?.routeSignals);
            const needsReflectionCandidate = metadata?.routeNeedsReflectionCandidate === true;
            const contract = readRecord(metadata?.blackboardContract);
            const plan = readRecord(metadata?.blackboardPlan);

            lines.push(panelLine("Route / Complexity", THEME.header, TextAttributes.BOLD));
            lines.push(
                panelLine(
                    `  ${routeScore !== undefined ? `score=${routeScore.toFixed(2)}` : "score=-"} · ${
                        routeReason ?? "reason=-"
                    }`,
                    THEME.fg,
                ),
            );
            if (needsReflectionCandidate) {
                lines.push(panelLine("  reflection candidate: yes", THEME.fgMuted));
            }
            if (routeSignals.length > 0) {
                lines.push(panelLine(`  signals: ${routeSignals.join(" · ")}`, THEME.fgMuted));
            }
            if (contract) {
                const contractMode = stringValue(contract.mode) ?? "normal";
                const policyReason = stringValue(contract.policyReason) ?? "default-convergence";
                lines.push(panelLine(`  contract: ${contractMode} · policy=${policyReason}`, THEME.fg));
                const evidence = readStringArray(contract.evidence);
                if (evidence.length > 0) {
                    lines.push(
                        panelLine(`  evidence: ${evidence.map((item) => clipText(item, 42)).join(" · ")}`, THEME.fgMuted),
                    );
                }
                for (const contradiction of readBlackboardContradictions(contract)) {
                    lines.push(
                        panelLine(
                            `  conflict: ${clipText(contradiction.left, 28)} ↔ ${clipText(contradiction.right, 28)} · ${clipText(
                                contradiction.reason,
                                48,
                            )}`,
                            THEME.fgMuted,
                        ),
                    );
                }
            }
            if (plan) {
                const objective = stringValue(plan.objective);
                const qaGoal = stringValue(plan.qaGoal);
                const workstreams = readStringArray(plan.workstreams);
                lines.push(panelLine("  plan", THEME.fgMuted));
                if (objective) {
                    lines.push(panelLine(`    objective: ${clipText(objective, 118)}`, THEME.fgMuted));
                }
                if (qaGoal) {
                    lines.push(panelLine(`    qa: ${clipText(qaGoal, 118)}`, THEME.fgMuted));
                }
                if (workstreams.length > 0) {
                    lines.push(panelLine(`    workstreams: ${workstreams.join(" / ")}`, THEME.fgMuted));
                }
            }
            if (turn.workers.length > 0) {
                lines.push(panelLine("  workers", THEME.fgMuted));
                for (const worker of turn.workers) {
                    const dependsOn = worker.dependsOn.length > 0 ? ` ← ${worker.dependsOn.join(",")}` : "";
                    lines.push(
                        panelLine(
                            `    ${worker.name} · ${worker.role} · ${worker.status} · ${worker.stage} · ${worker.handoff}${dependsOn}`,
                            THEME.fgMuted,
                        ),
                    );
                }
            }
            lines.push(panelLine("", THEME.fg));
        }

        function appendBlackboardPanelLines(lines: PanelLine[], turn: BlackboardTurn): void {
            const detailColor = THEME.purple;
            lines.push(panelLine("Blackboard", THEME.purple, TextAttributes.BOLD));
            lines.push(
                panelLine(
                    `  ${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`,
                    THEME.fg,
                ),
            );
            if (turn.goal.trim()) {
                lines.push(panelLine(`  goal: ${clipText(turn.goal, 160)}`, THEME.fgMuted));
            }
            for (const step of turn.steps) {
                const factCount = step.newFacts.length;
                const blockerCount = step.blockers.length;
                const suffix = [
                    `risk=${step.risk}`,
                    factCount > 0 ? `facts=${factCount}` : undefined,
                    blockerCount > 0 ? `blockers=${blockerCount}` : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                lines.push(
                    panelLine(
                        `  r${step.round} ${step.workerRole}: ${clipText(step.outputSummary)}${suffix ? ` (${suffix})` : ""}`,
                        detailColor,
                    ),
                );
            }
            const publicMessages = turn.messages.filter((message) => message.visibility === "public");
            for (const message of publicMessages) {
                const speaker = message.workerRole ?? message.role;
                const round = message.round !== undefined ? `r${message.round} ` : "";
                lines.push(panelLine(`  ${round}${speaker}: ${clipText(message.content)}`, detailColor));
            }
            const decision = turn.decisions[turn.decisions.length - 1];
            if (decision) {
                lines.push(panelLine(`  decision: ${clipText(decision.prompt, 180)}`, THEME.pink));
                if (decision.options.length > 0) {
                    lines.push(
                        panelLine(
                            `  options: ${decision.options.map((option) => option.label).join(" / ")}`,
                            THEME.pink,
                        ),
                    );
                }
            }
        }

        function panelLine(content: string, fg: RGBA, attributes?: number, bg?: RGBA): PanelLine {
            return { attributes, bg, content, fg };
        }

        function extraLine(content: string, fg: RGBA): TextRenderable {
            return new TextRenderable(renderer, {
                content,
                fg,
                selectable: true,
                width: "100%",
            });
        }

        function clipText(value: string, max = 140): string {
            const text = value.replace(/\s+/gu, " ").trim();
            return text.length > max ? `${text.slice(0, max - 1)}…` : text;
        }

        function numberValue(value: unknown): number | undefined {
            return typeof value === "number" && Number.isFinite(value) ? value : undefined;
        }

        function summarizeQuestion(question: string, ordinal: number, max: number): string {
            return `${ordinal}. ${clipText(question, max)}`;
        }

        function updateMessageExtras(renderable: MsgRenderable, msg: ChatMessage) {
            const nextKey = messageExtrasKey(msg);
            if (renderable.extrasKey === nextKey) return;
            if (renderable.extraBox) {
                renderable.box.remove(renderable.extraBox.id);
                renderable.extraBox = undefined;
            }
            const extraBox = buildExtras(msg);
            if (extraBox) {
                renderable.extraBox = extraBox;
                renderable.box.add(extraBox);
            }
            renderable.extrasKey = nextKey;
        }

        function hasMessageOrderChanged(msgs: ChatMessage[]): boolean {
            const sharedLength = Math.min(msgs.length, messageRenderables.length);
            for (let i = 0; i < sharedLength; i += 1) {
                if (msgs[i]?.id !== messageRenderables[i]?.id) return true;
            }
            return false;
        }

        function rebuildMessageList(msgs: ChatMessage[]): void {
            const content = scrollBox.content;
            while (messageRenderables.length > 0) {
                const item = messageRenderables.pop()!;
                content.remove(item.box.id);
            }
            for (const msg of msgs) {
                const item = buildMessageBox(msg);
                messageRenderables.push(item);
                content.add(item.box);
            }
            messageVirtualScrollBar.sync();
        }

        // ── 响应式同步：Header ───────────────────────────────
        createEffect(() => {
            const ph = phase();
            const def = PHASE_DEF[ph];
            const processing_ = processing();
            const frame = processing_ ? (def.frames[frameTick() % def.frames.length] ?? def.done) : def.done;
            const turnCount = messages().filter((m) => m.role === "user").length;
            topStatusText.content = `${frame} ${agentName} · ${processing_ ? def.label : "ready"} · ${turnCount} turns`;
            topStatusText.fg = processing_ ? def.color : THEME.header;
        });

        // ── 响应式同步：Error line ────────────────────────────
        createEffect(() => {
            const err = error();
            if (err) {
                errorText.content = `⚠ ${err}`;
                errorText.visible = true;
            } else {
                errorText.visible = false;
            }
        });

        createEffect(() => {
            statusText.content = statusNotice() ?? commandHintText(inputText()) ?? DEFAULT_STATUS_TEXT;
        });

        function commandHintText(text: string): string | undefined {
            const trimmed = text.trim();
            if (!trimmed.startsWith("/")) return undefined;
            const matched = matchAppCommand(appCommands, trimmed);
            if (matched && builtinActionOf(matched.rule) === AppCommandAction.OpenBlackboard) {
                return questionCommandHint(matched.name);
            }
            if (matched && builtinActionOf(matched.rule) === AppCommandAction.OpenThinking) {
                return questionCommandHint(matched.name);
            }
            const suggestions = commandSuggestions(trimmed);
            if (suggestions.length === 0) return "Unknown command · Tab cannot complete";
            return suggestions.map((command) => `${command.name} ${command.detail}`).join(" · ");
        }

        function questionCommandHint(command: string): string {
            const pairs = turnPairs();
            const items = pairs.slice(-4);
            if (items.length === 0) return `${command} has no sent questions yet`;
            if (inputText().trim() === command) return `${command}: Enter opens a question menu · Up/Down select`;
            return items
                .map(
                    (item, idx) =>
                        `${command} ${summarizeQuestion(item.question, pairs.length - items.length + idx + 1, 24)}`,
                )
                .join(" · ");
        }

        function syncPanelLines(
            content: BoxRenderable,
            renderables: TextRenderable[],
            lines: PanelLine[],
        ): void {
            while (renderables.length > lines.length) {
                const stale = renderables.pop()!;
                content.remove(stale.id);
            }
            for (let i = renderables.length; i < lines.length; i += 1) {
                const line = lines[i]!;
                const item = new TextRenderable(renderer, {
                    attributes: line.attributes,
                    bg: line.bg,
                    content: line.content,
                    fg: line.fg,
                    selectable: true,
                    width: "100%",
                });
                renderables.push(item);
                content.add(item);
            }
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i]!;
                const item = renderables[i]!;
                item.content = line.content;
                item.fg = line.fg;
                item.bg = line.bg;
                item.attributes = line.attributes ?? TextAttributes.NONE;
            }
        }

        // ── 响应式同步：右侧 todo / 思考 / 黑板面板 ─────────────
        createEffect(() => {
            const panelVisible = renderer.width >= 88;
            sidePanel.visible = panelVisible;
            if (!panelVisible) return;
            syncPanelLines(metricsContent, metricLineRenderables, resourcePanelLines());
            syncPanelLines(todoScrollBox.content, todoLineRenderables, todoPanelLines());
            syncPanelLines(detailScrollBox.content, detailLineRenderables, detailPanelLines());
            todoVirtualScrollBar.sync();
            detailVirtualScrollBar.sync();
        });

        // ── 响应式同步：消息列表（增量更新）────────────────────
        createEffect(() => {
            const msgs = messages();
            const content = scrollBox.content;

            if (hasMessageOrderChanged(msgs)) {
                rebuildMessageList(msgs);
                return;
            }

            // 移除多余的消息 renderables
            while (messageRenderables.length > msgs.length) {
                const r = messageRenderables.pop()!;
                content.remove(r.box.id);
            }

            // 添加新消息
            for (let i = messageRenderables.length; i < msgs.length; i++) {
                const msg = msgs[i];
                if (!msg) continue;
                const r = buildMessageBox(msg);
                messageRenderables.push(r);
                content.add(r.box);
            }

            // 同步已有消息：内容 + extras
            for (let i = 0; i < msgs.length && i < messageRenderables.length; i++) {
                const msg = msgs[i];
                const renderable = messageRenderables[i];
                if (!msg || !renderable) continue;
                updateMessageContent(renderable, msg);
                updateMessageExtras(renderable, msg);
            }
            messageVirtualScrollBar.sync();
        });

        // ── Cleanup ───────────────────────────────────────────
        return () => {
            destroyed = true;
            clearInterval(animTimer);
            if (historyPollTimer) clearInterval(historyPollTimer);
            if (statusNoticeTimer) clearTimeout(statusNoticeTimer);
            renderer.keyInput.off("keypress", keyHandler);
            renderer.off(CliRenderEvents.RESIZE, resizeHandler);
            renderer.off(CliRenderEvents.SELECTION, selectionHandler);
            if (originalStartSelection) {
                selectionRenderer.startSelection = originalStartSelection;
            }
            selectionRenderer.updateSelection = originalUpdateSelection;
            selectionRenderer.clearSelection = originalClearSelection;
            unsubscribeEvents?.();
            // remove main tree
            root.remove(mainBox.id);
            markdownSyntaxStyle.destroy();
            disposeSolid();
        };
    });
}

export interface ChatChromeLayout {
    defaultSidePanelMode: SidePanelMode;
    headerBrand: string;
    inputStatusText: string;
    metricsPanelHeight: number;
    sendIconText: string;
    sidePanelVisible: boolean;
    todoPanelHeight: number;
    sidePanelWidth: number;
}

export interface ChatResourceMetric {
    bar: string;
    color: RGBA;
    label: string;
    ratio?: number;
    value: string;
}

export interface ChatResourceSnapshot {
    memoryLine: string;
    metrics: ChatResourceMetric[];
    modelLine: string;
}

export interface ChatTodoSnapshot {
    progressLine: string;
    stepCount: number;
    steps: string[];
    workerLine?: string;
    workstreamCount: number;
    workstreams: string[];
}

export function buildChatTodoSnapshot(turn: BlackboardTurn | undefined): ChatTodoSnapshot {
    if (!turn) {
        return {
            progressLine: "no todo list yet",
            stepCount: 0,
            steps: [],
            workstreamCount: 0,
            workstreams: [],
        };
    }

    const metadata = readRecord(turn.metadata);
    const plan = readRecord(metadata?.blackboardPlan);
    const workstreams = readStringArray(plan?.workstreams).slice(0, 6);
    const totalRounds = Math.max(1, turn.budget.maxRounds);
    const stepCount = turn.steps.length;
    const doneWorkers = turn.workers.filter((worker) => worker.status === "done").length;
    const runningWorkers = turn.workers.filter((worker) => worker.status === "running").length;
    const blockedWorkers = turn.workers.filter((worker) => worker.status === "blocked").length;
    const clip = (value: string, max = 96): string => {
        const text = value.replace(/\s+/gu, " ").trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    };

    return {
        progressLine: `progress ${stepCount}/${totalRounds} rounds · workers ${doneWorkers}/${turn.workers.length}`,
        stepCount,
        steps: turn.steps.slice(-4).map((step) => `r${step.round} ${step.workerRole}: ${clip(step.outputSummary)}`),
        workerLine:
            turn.workers.length > 0
                ? `workers ${doneWorkers} done · ${runningWorkers} running · ${blockedWorkers} blocked`
                : undefined,
        workstreamCount: workstreams.length,
        workstreams,
    };
}

export function buildChatResourceSnapshot(input: {
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
}): ChatResourceSnapshot {
    const replyTokens = estimateTokens(input.reply?.content ?? "");
    const questionTokens = estimateTokens(input.questionText ?? "");
    const draftTokens = estimateTokens(input.draftText ?? "");
    const turnTokens = questionTokens + replyTokens;
    const contextBudget = finitePositive(input.activeFork?.maxContextTokens)
        ?? finitePositive(input.contextPressureBudgetTokens)
        ?? finitePositive(input.maxOutputTokens);
    const outputBudget = finitePositive(input.maxOutputTokens);
    const ringSize = finitePositive(input.contextRingSize);
    const identityLimit = finitePositive(input.identityAppendDailyLimit);
    const memoryActions = numberValueFromRecord(input.reply?.metadata, "memoryActions") ?? 0;
    const model = input.model && input.model.trim().length > 0 ? input.model : "model unknown";
    const provider = input.providerId && input.providerId.trim().length > 0 ? input.providerId : "provider unknown";
    const visibility = clampRatio(input.memoryVisibilityThreshold);

    return {
        memoryLine: [
            `actions ${memoryActions}`,
            `project ${input.activeProject ? "on" : "off"}`,
            `fork ${input.activeFork ? "on" : "off"}`,
        ].join(" · "),
        modelLine: `${provider} · ${model}`,
        metrics: [
            {
                bar: renderChatProgressBar(contextBudget ? turnTokens / contextBudget : undefined),
                color: THEME.header,
                label: "context",
                ratio: contextBudget ? clampRatio(turnTokens / contextBudget) : undefined,
                value: contextBudget ? `${turnTokens}/${contextBudget} tok` : `${turnTokens} tok`,
            },
            {
                bar: renderChatProgressBar(outputBudget ? replyTokens / outputBudget : undefined),
                color: THEME.purple,
                label: "reply",
                ratio: outputBudget ? clampRatio(replyTokens / outputBudget) : undefined,
                value: outputBudget ? `${replyTokens}/${outputBudget} tok` : `${replyTokens} tok`,
            },
            {
                bar: renderChatProgressBar(outputBudget ? draftTokens / outputBudget : undefined),
                color: THEME.gold,
                label: "draft",
                ratio: outputBudget ? clampRatio(draftTokens / outputBudget) : undefined,
                value: outputBudget ? `${draftTokens}/${outputBudget} tok` : `${draftTokens} tok`,
            },
            {
                bar: renderChatProgressBar(ringSize ? (input.turnCount ?? 0) / ringSize : undefined),
                color: THEME.pink,
                label: "memory",
                ratio: ringSize ? clampRatio((input.turnCount ?? 0) / ringSize) : undefined,
                value: ringSize ? `${input.turnCount ?? 0}/${ringSize} turns` : `${input.turnCount ?? 0} turns`,
            },
            {
                bar: renderChatProgressBar(visibility),
                color: THEME.fgMuted,
                label: "recall",
                ratio: visibility,
                value: input.memoryVisibilityThreshold === undefined
                    ? "gate unknown"
                    : `gate ${input.memoryVisibilityThreshold.toFixed(2)}`,
            },
            {
                bar: renderChatProgressBar(identityLimit ? memoryActions / identityLimit : undefined),
                color: THEME.user,
                label: "write",
                ratio: identityLimit ? clampRatio(memoryActions / identityLimit) : undefined,
                value: identityLimit ? `${memoryActions}/${identityLimit} daily` : `${memoryActions} actions`,
            },
        ],
    };
}

export function renderChatProgressBar(ratio: number | undefined, width = RESOURCE_BAR_WIDTH): string {
    const size = Math.max(1, Math.floor(width));
    if (ratio === undefined || !Number.isFinite(ratio)) return `${"·".repeat(size)} --%`;
    const bounded = Math.min(1, Math.max(0, ratio));
    const filled = Math.min(size, Math.max(0, Math.round(bounded * size)));
    return `${"█".repeat(filled)}${"░".repeat(size - filled)} ${Math.round(bounded * 100)
        .toString()
        .padStart(2, " ")}%`;
}

export function chatChromeLayout(totalWidth: number, totalHeight: number): ChatChromeLayout {
    const sidePanelWidth = rightPanelWidth(totalWidth);
    return {
        defaultSidePanelMode: "blackboard",
        headerBrand: CHAT_HEADER_BRAND,
        inputStatusText: DEFAULT_STATUS_TEXT,
        metricsPanelHeight: metricsPanelHeight(totalHeight),
        sendIconText: SEND_ICON_TEXT,
        sidePanelVisible: sidePanelWidth > 0,
        todoPanelHeight: todoPanelHeight(totalHeight),
        sidePanelWidth,
    };
}

function rightPanelWidth(totalWidth: number): number {
    if (totalWidth < 88) return 0;
    return Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, Math.floor(totalWidth * SIDE_PANEL_RATIO)));
}

function metricsPanelHeight(totalHeight: number): number {
    return Math.min(
        METRICS_PANEL_MAX_HEIGHT,
        Math.max(METRICS_PANEL_MIN_HEIGHT, Math.floor(totalHeight * METRICS_PANEL_HEIGHT_RATIO)),
    );
}

function todoPanelHeight(totalHeight: number): number {
    return Math.min(TODO_PANEL_MAX_HEIGHT, Math.max(TODO_PANEL_MIN_HEIGHT, Math.floor(totalHeight * TODO_PANEL_HEIGHT_RATIO)));
}

function knownCommandList(registry: AppCommandRegistry): string {
    const names = registry.rules
        .filter((rule) => rule.enabled)
        .map((rule) => rule.match.slash[0])
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .slice(0, 8);
    return names.length > 0 ? names.join(", ") : "configured commands";
}

export function selectedTextForScope(
    selection: Selection | null,
    scope: SelectionScope,
    containers: { chat: Renderable; side: Renderable },
): string {
    if (!selection) return "";
    if (!scope) return selection.getSelectedText();
    const container = scope === "chat" ? containers.chat : containers.side;
    return selection.selectedRenderables
        .filter((renderable) => isRenderableWithin(renderable, container))
        .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
        .map((renderable) => renderable.getSelectedText())
        .filter((text) => text.length > 0)
        .join("\n");
}

function estimateTokens(text: string): number {
    const chars = text.trim().length;
    return chars === 0 ? 0 : Math.ceil(chars / 4);
}

function finitePositive(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function clampRatio(value: number | undefined): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    return Math.min(1, Math.max(0, value));
}

function numberValueFromRecord(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRenderableWithin(renderable: Renderable | undefined, container: Renderable): boolean {
    let current: Renderable | null | undefined = renderable;
    while (current) {
        if (current === container) return true;
        current = current.parent;
    }
    return false;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function readBlackboardContradictions(
    contract: Record<string, unknown>,
): Array<{ left: string; reason: string; right: string }> {
    const contradictions = contract.contradictions;
    if (!Array.isArray(contradictions)) {
        return [];
    }
    return contradictions
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
            left: typeof item.left === "string" ? item.left : "",
            reason: typeof item.reason === "string" ? item.reason : "",
            right: typeof item.right === "string" ? item.right : "",
        }))
        .filter((item) => item.left.length > 0 && item.right.length > 0 && item.reason.length > 0);
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

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
    SyntaxStyle,
    TextareaRenderable,
    type CliRenderer,
    RGBA,
    TextAttributes,
} from "@opentui/core";
import { createSignal, createEffect, createRoot, batch } from "solid-js";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../../protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";
import type { ChatEntryOptions } from "./index.ts";
import { formatAskSummaryLines } from "./ask.render.ts";
import { copyTextToTerminalClipboard } from "./clipboard.ts";
import { readAskMeta, readBlackboardMeta, readMcpTrace, readRecord, readStringArray } from "./metadata.parse.ts";
import type { ChatMessage, McpTrace, Phase } from "./types.ts";
import type { BlackboardTurn } from "../../../agent/blackboard/index.ts";

const PHASE_DEF: Record<Phase, { label: string; color: RGBA; done: string; frames: string[] }> = {
    idle: {
        label: "ready",
        color: RGBA.fromInts(100, 200, 255),
        done: "▪",
        frames: ["▪"],
    },
    thinking: {
        label: "thinking",
        color: RGBA.fromInts(255, 200, 100),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    blackboard: {
        label: "blackboard",
        color: RGBA.fromInts(180, 140, 255),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    mcp: {
        label: "mcp",
        color: RGBA.fromInts(100, 255, 150),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    skill: {
        label: "skill",
        color: RGBA.fromInts(255, 150, 100),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
    streaming: {
        label: "streaming",
        color: RGBA.fromInts(100, 200, 255),
        done: "●",
        frames: ["◐", "◓", "◑", "◒"],
    },
};

const THEME = {
    bg: RGBA.fromInts(15, 15, 15),
    fg: RGBA.fromInts(220, 220, 220),
    fgMuted: RGBA.fromInts(120, 120, 120),
    user: RGBA.fromInts(100, 200, 255),
    assistant: RGBA.fromInts(220, 220, 220),
    error: RGBA.fromInts(255, 80, 80),
    border: RGBA.fromInts(60, 60, 60),
    header: RGBA.fromInts(100, 200, 255),
};

const DEFAULT_STATUS_TEXT = "Enter to send · Ctrl+C to exit · /clear to reset";
const HISTORY_BATCH_SIZE = 20;

interface MsgRenderable {
    id: string;
    box: BoxRenderable;
    content: string;
    contentText: TextRenderable | MarkdownRenderable;
    extrasKey: string;
    extraBox?: BoxRenderable;
}

export function createChatApp(renderer: CliRenderer, options: ChatEntryOptions): () => void {
    return createRoot((disposeSolid) => {
        const { runtime, blackboard, eventBus, approveMcpToolCall, agentName = "flyflor", userId = "human" } = options;

        // ── 状态 ──────────────────────────────────────────────
        const [messages, setMessages] = createSignal<ChatMessage[]>([], { equals: false });
        const [phase, setPhase] = createSignal<Phase>("idle");
        const [processing, setProcessing] = createSignal(false);
        const [error, setError] = createSignal<string | null>(null);
        const [frameTick, setFrameTick] = createSignal(0);
        const [statusNotice, setStatusNotice] = createSignal<string | null>(null);
        const [blackboardTurns, setBlackboardTurns] = createSignal<Record<string, BlackboardTurn>>(
            {},
            { equals: false },
        );

        let currentTurnId: string | null = null;
        let inputRef: TextareaRenderable | undefined;
        let exitArmed = false;
        let destroyed = false;
        let statusNoticeTimer: ReturnType<typeof setTimeout> | undefined;
        const markdownSyntax = SyntaxStyle.create();
        const messageRenderables: MsgRenderable[] = [];
        const pendingBlackboardRefreshes = new Set<string>();
        const loadedHistoryEventIds = new Set<string>();
        let historyExhausted = false;
        let historyLoading = false;
        let oldestHistoryTs: number | undefined;

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
            const text = renderer.getSelection()?.getSelectedText() ?? "";
            if (text.trim().length === 0) return false;
            try {
                copyTextToTerminalClipboard(text);
                showStatusNotice(`Copied ${text.length} chars`);
                return true;
            } catch (cause) {
                const messageText = describeError(cause);
                setError(`Copy failed: ${messageText}`);
                console.error(cause);
                return false;
            }
        }

        function stringValue(value: unknown): string | undefined {
            return typeof value === "string" ? value : undefined;
        }

        function applyBlackboardEvent(type: RuntimeEventType, payload: Record<string, unknown> | null): void {
            const turnId = stringValue(payload?.turnId);
            if (!turnId) return;

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
            eventId: string;
            ts: number;
            userText: string;
        }): ChatMessage[] {
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
                },
            ];
        }

        async function loadOlderHistory(reason: "initial" | "scroll"): Promise<void> {
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
                queueMicrotask(() => {
                    if (reason === "scroll") {
                        const delta = scrollBox.scrollHeight - previousHeight;
                        scrollBox.scrollTop = previousTop + Math.max(0, delta);
                        return;
                    }
                    scrollBox.scrollTo({ x: scrollBox.scrollLeft, y: Math.max(0, scrollBox.scrollHeight - scrollBox.viewport.height) });
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
            if (processing() || !text.trim()) return;

            const turnId = crypto.randomUUID();
            const startedAt = new Date().toISOString();

            batch(() => {
                setMessages((prev) => [
                    ...prev,
                    { id: crypto.randomUUID(), role: "user", content: text.trim(), status: "done" },
                    { id: turnId, role: "assistant", content: "", status: "streaming", mcpCalls: [], skills: [] },
                ]);
                setProcessing(true);
                setError(null);
                setPhase("thinking");
            });

            currentTurnId = turnId;

            const context: RuntimeContext = {
                now: startedAt,
                requestId: crypto.randomUUID(),
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
                    onTextDelta: (chunk: string) => {
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
                if (blackboardMeta?.turnId) {
                    void refreshBlackboardTurn(blackboardMeta.turnId);
                }

                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.id === turnId && last.role === "assistant") {
                        last.content = reply.text;
                        last.status = "done";
                        last.ask = askMeta;
                        last.blackboard = blackboardMeta;
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
                batch(() => {
                    setProcessing(false);
                    setPhase("idle");
                });
            }
        }

        // ── 退出处理 ──────────────────────────────────────────
        function handleExit(): void {
            if (processing()) {
                setError("Wait for the current turn to finish before exiting.");
                return;
            }
            if (inputRef && inputRef.plainText.length > 0) {
                inputRef.clear();
                setError("Input cleared. Press Ctrl+C again to exit.");
                exitArmed = true;
                return;
            }
            if (!exitArmed) {
                setError("Press Ctrl+C again to exit Flyflor chat.");
                exitArmed = true;
                return;
            }
            destroyed = true;
            renderer.destroy();
        }

        // ── 提交处理 ──────────────────────────────────────────
        function onSubmit() {
            if (!inputRef) return;
            const text = inputRef.plainText.trim();
            if (!text) return;
            if (text === "/clear" || text === "/reset") {
                batch(() => {
                    setMessages([]);
                    setError(null);
                });
                inputRef.clear();
                return;
            }
            if (text === "/exit" || text === "/quit") {
                destroyed = true;
                renderer.destroy();
                return;
            }
            inputRef.clear();
            exitArmed = false;
            setError(null);
            void sendMessage(text);
        }

        // ── 命令式 UI 树 ──────────────────────────────────────
        const root = renderer.root;

        // 主容器
        const mainBox = new BoxRenderable(renderer, {
            flexDirection: "column",
            width: renderer.width,
            height: renderer.height,
            backgroundColor: THEME.bg,
        });

        // Header
        const headerBox = new BoxRenderable(renderer, {
            flexDirection: "column",
            border: ["bottom"],
            borderColor: THEME.border,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1,
            paddingBottom: 1,
            flexShrink: 0,
        });
        const headerText = new TextRenderable(renderer, {
            content: "",
            fg: THEME.header,
            attributes: TextAttributes.BOLD,
        });
        headerBox.add(headerText);
        mainBox.add(headerBox);

        // Error line
        const errorText = new TextRenderable(renderer, {
            content: "",
            fg: THEME.error,
        });
        errorText.visible = false;
        mainBox.add(errorText);

        // Messages scroll box
        const scrollBox = new ScrollBoxRenderable(renderer, {
            flexGrow: 1,
            flexShrink: 1,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            stickyScroll: true,
            stickyStart: "bottom",
        });
        mainBox.add(scrollBox);

        // Input area
        const inputBox = new BoxRenderable(renderer, {
            flexDirection: "column",
            border: ["top"],
            borderColor: THEME.border,
            flexShrink: 0,
        });
        const input = new TextareaRenderable(renderer, {
            placeholder: "Ask anything...",
            placeholderColor: THEME.fgMuted,
            backgroundColor: THEME.bg,
            focusedBackgroundColor: THEME.bg,
            textColor: THEME.fg,
            focusedTextColor: THEME.fg,
            cursorColor: THEME.fg,
            showCursor: true,
            width: "100%",
            minHeight: 1,
            maxHeight: 6,
            wrapMode: "word",
            keyBindings: [
                { name: "return", action: "submit" },
                { name: "linefeed", action: "submit" },
            ],
            onSubmit,
        });
        inputBox.add(input);
        inputRef = input;
        input.onSubmit = () => {
            onSubmit();
        };

        // Status bar
        const statusBox = new BoxRenderable(renderer, {
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
        });
        const statusText = new TextRenderable(renderer, {
            content: DEFAULT_STATUS_TEXT,
            fg: THEME.fgMuted,
            selectable: true,
        });
        statusBox.add(statusText);
        inputBox.add(statusBox);
        mainBox.add(inputBox);

        root.add(mainBox);

        // Wire input events directly
        input.focus();
        renderer.requestRender();
        input.showCursor = true;
        input.cursorColor = THEME.fg;
        input.cursorStyle = { style: "line", blinking: true };
        void loadOlderHistory("initial");
        historyPollTimer = setInterval(() => {
            if (destroyed || historyLoading || historyExhausted) return;
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
            const name = event.name ?? "";
            if (event.ctrl && name === "c" && renderer.hasSelection) {
                if (copySelectionToClipboard()) {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                }
                return;
            }
            if ((event.ctrl && event.shift && name === "c") || (event.ctrl && name === "y")) {
                if (copySelectionToClipboard()) {
                    event.preventDefault?.();
                    event.stopPropagation?.();
                }
                return;
            }
            if (event.ctrl && event.name === "c") {
                handleExit();
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

            const contentText =
                msg.role === "assistant"
                    ? new MarkdownRenderable(renderer, {
                          content: msg.content,
                          fg: THEME.fg,
                          syntaxStyle: markdownSyntax,
                          streaming: msg.status === "streaming",
                          width: "100%",
                      })
                    : new TextRenderable(renderer, {
                          content: msg.content,
                          fg: THEME.fg,
                          selectable: true,
                          width: "100%",
                      });
            box.add(contentText);

            const extraBox = buildExtras(msg);
            if (extraBox) {
                box.add(extraBox);
            }

            return { id: msg.id, box, content: msg.content, contentText, extrasKey: messageExtrasKey(msg), extraBox };
        }

        function messageExtrasKey(msg: ChatMessage): string {
            return JSON.stringify({
                ask: msg.ask ?? null,
                blackboard: msg.blackboard ?? null,
                blackboardTurn: blackboardTurnKey(msg),
                mcpCalls: msg.mcpCalls ?? [],
                phase: msg.status === "streaming" && !msg.content ? phase() : undefined,
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
                    const color = call.ok ? RGBA.fromInts(100, 255, 150) : THEME.error;
                    extras.push(
                        new TextRenderable(renderer, {
                            content: `  ${icon} ${call.server}.${call.tool}`,
                            fg: color,
                            selectable: true,
                        }),
                    );
                }
            }

            if (msg.skills && msg.skills.length > 0) {
                extras.push(
                    new TextRenderable(renderer, {
                        content: `  skills: ${msg.skills.join(", ")}`,
                        fg: RGBA.fromInts(255, 200, 100),
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
                        fg: RGBA.fromInts(255, 200, 100),
                        selectable: true,
                    }),
                );
                for (const line of formatAskSummaryLines(ask)) {
                    extras.push(
                        extraLine(line, RGBA.fromInts(255, 200, 100)),
                    );
                }
            }

            if (msg.blackboard) {
                const bb = msg.blackboard;
                const turn = blackboardTurnFor(msg);
                const detail = [
                    bb.mode,
                    turn?.status ?? bb.status,
                    turn
                        ? `${turn.messages.length} messages`
                        : bb.messages !== undefined
                          ? `${bb.messages} messages`
                          : undefined,
                    turn ? `${turn.steps.length} steps` : undefined,
                    turn ? `${turn.decisions.length} decisions` : undefined,
                    bb.elapsedMs !== undefined ? `${bb.elapsedMs}ms` : undefined,
                    bb.turnId ? `turn=${bb.turnId}` : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                extras.push(
                    new TextRenderable(renderer, {
                        content: `  blackboard: ${detail}`,
                        fg: RGBA.fromInts(180, 140, 255),
                        selectable: true,
                    }),
                );
                appendBlackboardDetails(extras, turn);
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

        function blackboardTurnKey(msg: ChatMessage): string | undefined {
            const turn = blackboardTurnFor(msg);
            if (!turn) return undefined;
            return JSON.stringify({
                decisions: turn.decisions.map((decision) => decision.id),
                messages: turn.messages.length,
                status: turn.status,
                steps: turn.steps.map((step) => step.id),
                updatedAt: turn.updatedAt,
                workers: turn.workers.map((worker) => [worker.role, worker.status, worker.updatedAt]),
            });
        }

        function appendBlackboardDetails(extras: TextRenderable[], turn: BlackboardTurn | undefined): void {
            if (!turn) return;
            const detailColor = RGBA.fromInts(180, 140, 255);
            if (turn.workers.length > 0) {
                extras.push(
                    extraLine(
                        `    workers: ${turn.workers.map((w) => `${w.name}:${w.status}`).join(", ")}`,
                        detailColor,
                    ),
                );
            }
            for (const step of turn.steps.slice(-4)) {
                const factCount = step.newFacts.length;
                const blockerCount = step.blockers.length;
                const suffix = [
                    `risk=${step.risk}`,
                    factCount > 0 ? `facts=${factCount}` : undefined,
                    blockerCount > 0 ? `blockers=${blockerCount}` : undefined,
                ]
                    .filter(Boolean)
                    .join(" · ");
                extras.push(
                    extraLine(
                        `    r${step.round} ${step.workerRole}: ${clipText(step.outputSummary)}${suffix ? ` (${suffix})` : ""}`,
                        detailColor,
                    ),
                );
            }
            const publicMessages = turn.messages.filter((message) => message.visibility === "public").slice(-3);
            for (const message of publicMessages) {
                const speaker = message.workerRole ?? message.role;
                const round = message.round !== undefined ? `r${message.round} ` : "";
                extras.push(extraLine(`    ${round}${speaker}: ${clipText(message.content)}`, detailColor));
            }
            const decision = turn.decisions[turn.decisions.length - 1];
            if (decision) {
                extras.push(extraLine(`    decision: ${clipText(decision.prompt, 180)}`, RGBA.fromInts(255, 200, 100)));
                if (decision.options.length > 0) {
                    extras.push(
                        extraLine(
                            `    options: ${decision.options.map((option) => option.label).join(" / ")}`,
                            RGBA.fromInts(255, 200, 100),
                        ),
                    );
                }
            }
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

        // ── 响应式同步：Header ───────────────────────────────
        createEffect(() => {
            const ph = phase();
            const def = PHASE_DEF[ph];
            const processing_ = processing();
            const frame = processing_ ? (def.frames[frameTick() % def.frames.length] ?? def.done) : def.done;
            const turnCount = messages().filter((m) => m.role === "user").length;
            headerText.content = `${frame} ${agentName} · ${processing_ ? def.label : "ready"} · ${turnCount} turns`;
            headerText.fg = processing_ ? def.color : THEME.header;
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
            statusText.content = statusNotice() ?? DEFAULT_STATUS_TEXT;
        });

        // ── 响应式同步：消息列表（增量更新）────────────────────
        createEffect(() => {
            const msgs = messages();
            const content = scrollBox.content;

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
                if (renderable.id !== msg.id) {
                    // ID 不匹配，重建该位置
                    content.remove(renderable.box.id);
                    const newR = buildMessageBox(msg);
                    messageRenderables[i] = newR;
                    content.add(newR.box);
                } else {
                    // 更新内容文本
                    if (renderable.content !== msg.content) {
                        renderable.content = msg.content;
                        renderable.contentText.content = msg.content;
                    }
                    if (renderable.contentText instanceof MarkdownRenderable) {
                        renderable.contentText.streaming = msg.status === "streaming";
                    }
                    // 更新 extras（简化：总是重建 extras box）
                    updateMessageExtras(renderable, msg);
                }
            }
        });

        // ── Cleanup ───────────────────────────────────────────
        return () => {
            destroyed = true;
            clearInterval(animTimer);
            if (historyPollTimer) clearInterval(historyPollTimer);
            if (statusNoticeTimer) clearTimeout(statusNoticeTimer);
            renderer.keyInput.off("keypress", keyHandler);
            renderer.off(CliRenderEvents.SELECTION, selectionHandler);
            unsubscribeEvents?.();
            markdownSyntax.destroy();
            // remove main tree
            root.remove(mainBox.id);
            disposeSolid();
        };
    });
}

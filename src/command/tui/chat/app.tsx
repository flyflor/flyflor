/**
 * Chat TUI 应用根 — 状态管理 + 事件处理 + 命令式 UI 装配
 * 使用 OpenTUI 纯命令式 API，绕过 Solid reconciler 的 ref/事件绑定问题。
 */

import {
    BoxRenderable,
    TextRenderable,
    ScrollBoxRenderable,
    InputRenderable,
    InputRenderableEvents,
    type CliRenderer,
    RGBA,
    TextAttributes,
} from "@opentui/core";
import {
    createSignal,
    createEffect,
    batch,
} from "solid-js";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../../protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../../../protocol/events/index.ts";
import type { ChatEntryOptions } from "./index.ts";
import { readAskMeta, readBlackboardMeta, readMcpTrace, readRecord, readStringArray } from "./metadata.parse.ts";
import type { ChatMessage, McpTrace, Phase } from "./types.ts";

const PHASE_DEF: Record<
    Phase,
    { label: string; color: RGBA; done: string; frames: string[] }
> = {
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

interface MsgRenderable {
    id: string;
    box: BoxRenderable;
    content: string;
    contentText: TextRenderable;
    extrasKey: string;
    extraBox?: BoxRenderable;
}

export function createChatApp(
    renderer: CliRenderer,
    options: ChatEntryOptions,
): () => void {
    const { runtime, eventBus, approveMcpToolCall, agentName = "flyflor", userId = "human" } = options;

    // ── 状态 ──────────────────────────────────────────────
    const [messages, setMessages] = createSignal<ChatMessage[]>([], { equals: false });
    const [phase, setPhase] = createSignal<Phase>("idle");
    const [processing, setProcessing] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [frameTick, setFrameTick] = createSignal(0);

    let currentTurnId: string | null = null;
    let inputRef: InputRenderable | undefined;
    let exitArmed = false;
    let destroyed = false;
    const messageRenderables: MsgRenderable[] = [];

    // ── 动画帧 ────────────────────────────────────────────
    const animTimer = setInterval(() => {
        if (processing() && !destroyed) setFrameTick((t) => t + 1);
    }, 180);

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
                                    const key = JSON.stringify([trace.server, trace.tool, trace.ok, trace.resultText]);
                                    if (!merged.some((m) => JSON.stringify([m.server, m.tool, m.ok, m.resultText]) === key)) {
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
                        event.type === RuntimeEventType.BlackboardMessageAppended
                    ) {
                        setPhase("blackboard");
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
                            if (!merged.some((m) => JSON.stringify([m.server, m.tool, m.ok, m.resultText]) === key)) {
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
            const messageText = cause instanceof Error ? cause.message : String(cause);
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
        if (inputRef && inputRef.value.length > 0) {
            inputRef.value = "";
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
        const text = inputRef.value.trim();
        if (!text) return;
        if (text === "/clear" || text === "/reset") {
            batch(() => {
                setMessages([]);
                setError(null);
            });
            inputRef.value = "";
            return;
        }
        if (text === "/exit" || text === "/quit") {
            destroyed = true;
            renderer.destroy();
            return;
        }
        inputRef.value = "";
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
    const input = new InputRenderable(renderer, {
        placeholder: "Ask anything...",
        placeholderColor: THEME.fgMuted,
        textColor: THEME.fg,
        cursorColor: THEME.fg,
        showCursor: true,
    });
    inputBox.add(input);
    inputRef = input;

    // Status bar
    const statusBox = new BoxRenderable(renderer, {
        paddingLeft: 1,
        paddingRight: 1,
        paddingBottom: 1,
    });
    const statusText = new TextRenderable(renderer, {
        content: "Enter to send · Ctrl+C to exit · /clear to reset",
        fg: THEME.fgMuted,
    });
    statusBox.add(statusText);
    inputBox.add(statusBox);
    mainBox.add(inputBox);

    root.add(mainBox);

    // Wire input events directly
    input.focus();
    input.showCursor = true;
    input.cursorColor = THEME.fg;
    input.cursorStyle = { style: "line", blinking: true };
    input.on(InputRenderableEvents.ENTER, onSubmit);

    // Keyboard handler
    const keyHandler = (event: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }) => {
        if (event.ctrl && event.name === "c") {
            handleExit();
        }
    };
    renderer.keyInput.on("keypress", keyHandler);

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
            content: msg.role === "user" ? "You" : agentName,
            fg: msg.role === "user" ? THEME.user : THEME.assistant,
            attributes: TextAttributes.BOLD,
        });
        box.add(roleText);

        const contentText = new TextRenderable(renderer, {
            content: msg.content,
            fg: THEME.fg,
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
            extras.push(new TextRenderable(renderer, {
                content: `${frame} ${def.label}...`,
                fg: def.color,
            }));
        }

        if (msg.mcpCalls && msg.mcpCalls.length > 0) {
            for (const call of msg.mcpCalls) {
                const icon = call.ok ? "ok" : "fail";
                const color = call.ok ? RGBA.fromInts(100, 255, 150) : THEME.error;
                extras.push(new TextRenderable(renderer, {
                    content: `  ${icon} ${call.server}.${call.tool}`,
                    fg: color,
                }));
            }
        }

        if (msg.skills && msg.skills.length > 0) {
            extras.push(new TextRenderable(renderer, {
                content: `  skills: ${msg.skills.join(", ")}`,
                fg: RGBA.fromInts(255, 200, 100),
            }));
        }

        if (msg.ask) {
            const ask = msg.ask;
            const detail = [
                ask.reason ? `reason=${ask.reason}` : undefined,
                ask.questions ? `questions=${ask.questions}` : undefined,
                ask.choices ? `choices=${ask.choices}` : undefined,
                ask.snapshotId ? `snapshot=${ask.snapshotId}` : undefined,
            ].filter(Boolean).join(" · ");
            extras.push(new TextRenderable(renderer, {
                content: `  ask: ${detail || "pending user clarification"}`,
                fg: RGBA.fromInts(255, 200, 100),
            }));
        }

        if (msg.blackboard) {
            const bb = msg.blackboard;
            const detail = [
                bb.mode,
                bb.status,
                bb.messages !== undefined ? `${bb.messages} messages` : undefined,
                bb.elapsedMs !== undefined ? `${bb.elapsedMs}ms` : undefined,
                bb.turnId ? `turn=${bb.turnId}` : undefined,
            ].filter(Boolean).join(" · ");
            extras.push(new TextRenderable(renderer, {
                content: `  blackboard: ${detail}`,
                fg: RGBA.fromInts(180, 140, 255),
            }));
        }

        if (extras.length === 0) return undefined;
        const box = new BoxRenderable(renderer, { flexDirection: "column" });
        for (const t of extras) box.add(t);
        return box;
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
        const frame = processing_
            ? def.frames[frameTick() % def.frames.length] ?? def.done
            : def.done;
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
                // 更新 extras（简化：总是重建 extras box）
                updateMessageExtras(renderable, msg);
            }
        }
    });

    // ── Cleanup ───────────────────────────────────────────
    return () => {
        destroyed = true;
        clearInterval(animTimer);
        renderer.keyInput.off("keypress", keyHandler);
        unsubscribeEvents?.();
        // remove main tree
        root.remove(mainBox.id);
    };
}

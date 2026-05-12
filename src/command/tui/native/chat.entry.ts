/**
 * 新 TUI 聊天入口 — 基于 ANSI 直接控制的零虚拟 DOM 实现。
 *
 * 替代 chat.tui.tsx 中的 ChatTui React 组件。
 * 复刻 DeepSeek-TUI 的界面风格：左侧对话 + 右侧 inspector + 底部输入框。
 *
 * 依赖 Screen / Viewport / Composer / Panel + render.utils
 * 零 React/Ink 依赖，bun build --compile 完全兼容。
 */

import { Screen } from "./screen.ts";
import type { KeyEvent, MouseEvent } from "./screen.ts";
import { Viewport } from "./viewport.ts";
import { Composer } from "./composer.ts";
import { Panel } from "./panel.ts";
import type { Phase, Turn } from "./render.utils.ts";
import {
    THEME,
    PHASE_DEF,
    readBlackboardMeta,
    readStringArray,
    readRecord,
    readString,
    readNumber,
    uniqueStrings,
    buildConversationLines,
    buildStreamingLines,
    buildInspectorLines,
} from "./render.utils.ts";
import {
    Channel,
    ChatType,
    type GatewayMessage,
    type GatewayReply,
    type RuntimeContext,
    type RuntimeEvent,
} from "../../../protocol/contracts/index.ts";
import { RuntimeEventType, RuntimeEventBus, type EventSink } from "../../../protocol/events/index.ts";
import type { RuntimeModule } from "../../../agent/runtime/index.ts";
import type { BlackboardModule } from "../../../agent/blackboard/index.ts";
import type { McpToolCallRequest } from "../../../agent/mcp/index.ts";

const MAX_VISIBLE_TURNS = 128;
const BREAKPOINT_INSPECTOR = 140;
const FRAME_MS = 33; // ~30fps
const ANIM_FRAME_MS = 180; // phase 动画帧间隔

export interface ChatEntryOptions {
    runtime: RuntimeModule;
    blackboard?: BlackboardModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    userId?: string;
}

export async function startChatEntry(options: ChatEntryOptions): Promise<void> {
    const {
        runtime,
        blackboard,
        approveMcpToolCall,
        agentName = "flyflor",
        userId = "human",
    } = options;

    // ── 初始化组件 ────────────────────────────────────────
    const screen = new Screen();
    const viewport = new Viewport({ topRow: 3, height: 20, leftCol: 0, width: 80 });
    const composer = new Composer();
    const panel = new Panel();

    // ── 状态 ──────────────────────────────────────────────
    let turns: Turn[] = [];
    let processing = false;
    let phase: Phase = "idle";
    let error: string | null = null;
    let scrollOffset = 0;
    let streamingText = "";
    let exitArmed = false;
    let currentTurnId: string | null = null;

    // ── 辅助函数 ──────────────────────────────────────────

    function updateTurnById(turnId: string | null, recipe: (turn: Turn) => Turn): void {
        if (!turnId) return;
        turns = turns.map((turn) => (turn.id === turnId ? recipe(turn) : turn));
    }

    // ── 构建 ViewLine[] ────────────────────────────────────
    function buildHistoryLines(viewWidth: number): import("./render.utils.ts").ViewLine[] {
        if (turns.length === 0) return buildConversationLines([], viewWidth, false);
        const source = processing ? turns.slice(0, -1) : turns;
        if (source.length === 0) return [];
        return buildConversationLines(source, viewWidth, false);
    }

    function buildActiveLines(viewWidth: number): import("./render.utils.ts").ViewLine[] {
        if (!processing || turns.length === 0) return [];
        const source = turns[turns.length - 1];
        if (!source) return [];
        return buildStreamingLines(source, streamingText, viewWidth, phase);
    }

    function buildAllLines(viewWidth: number): import("./render.utils.ts").ViewLine[] {
        const hist = buildHistoryLines(viewWidth);
        const active = buildActiveLines(viewWidth);
        if (active.length === 0) return hist;
        if (hist.length === 0) return active;
        return [...hist, { color: THEME.border, text: "─".repeat(Math.max(4, viewWidth)) }, ...active];
    }

    // ── MCP trace 辅助 ────────────────────────────────────

    function readMcpTrace(entry: unknown): Turn["mcpCalls"][number] | null {
        const record = readRecord(entry);
        if (!record) return null;
        return {
            ok: record.ok === true,
            resultText: readString(record.resultSummary) ?? readString(record.resultText) ?? "",
            server: readString(record.server) ?? "",
            tool: readString(record.tool) ?? "",
        };
    }

    function mergeTraces(a: Turn["mcpCalls"], b: Turn["mcpCalls"]): Turn["mcpCalls"] {
        const seen = new Set<string>();
        const merged: Turn["mcpCalls"] = [];
        for (const trace of [...a, ...b]) {
            const key = JSON.stringify([trace.server, trace.tool, trace.ok, trace.resultText]);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(trace);
        }
        return merged;
    }

    // ── turns 操作 ────────────────────────────────────────

    function addTurn(turn: Turn): void {
        turns = [...turns, turn];
        if (turns.length > MAX_VISIBLE_TURNS) {
            turns = turns.slice(turns.length - MAX_VISIBLE_TURNS);
        }
    }

    function latestTurn(): Turn | null {
        return turns.at(-1) ?? null;
    }

    // ── maxScroll ─────────────────────────────────────────

    function maxScroll(): number {
        const { cols } = screen.getSize();
        const showInspector = cols >= BREAKPOINT_INSPECTOR;
        const conversationWidth = showInspector ? cols - 38 : cols;
        const viewWidth = Math.max(1, conversationWidth - 3);
        const lines = buildAllLines(viewWidth);
        const viewportHeight = screen.getSize().rows - 10;
        return Math.max(0, lines.length - viewportHeight);
    }

    // ── send ──────────────────────────────────────────────

    async function handleSubmit(): Promise<void> {
        const text = composer.submit();
        if (!text || processing) return;

        const startedAt = new Date().toISOString();
        const turnId = crypto.randomUUID();
        const turn: Turn = {
            assistantText: "",
            blackboard: null,
            blackboardTurn: null,
            completedAt: null,
            error: null,
            id: turnId,
            mcpCalls: [],
            metadata: null,
            skills: [],
            startedAt,
            userMessage: text,
        };

        currentTurnId = turnId;
        processing = true;
        error = null;
        scrollOffset = 0;
        streamingText = "";
        phase = "thinking";
        addTurn(turn);

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
            text,
            user: { id: userId },
        };

        try {
            const reply = await runtime.handleMessage(message, context, {
                approveMcpToolCall: approveMcpToolCall ?? (async () => true),
                onTextDelta: (chunk: string) => {
                    streamingText += chunk;
                    phase = "streaming";
                },
            });

            const blackboardMeta = readBlackboardMeta(reply.metadata ?? null);

            streamingText = "";
            updateTurnById(turnId, (item) => ({
                ...item,
                assistantText: reply.text,
                blackboard: blackboardMeta,
                completedAt: new Date().toISOString(),
                mcpCalls: mergeTraces(
                    item.mcpCalls,
                    (() => {
                        const source = readRecord(reply.metadata);
                        const executions = source?.mcpToolExecutions;
                        if (!Array.isArray(executions)) return [];
                        return executions
                            .map((entry) => readMcpTrace(entry))
                            .filter((t): t is NonNullable<typeof t> => Boolean(t));
                    })(),
                ),
                metadata: (reply.metadata ?? null) as Record<string, unknown> | null,
                skills: uniqueStrings([
                    ...item.skills,
                    ...readStringArray(
                        (readRecord(reply.metadata) as Record<string, unknown> | undefined)?.skills,
                    ),
                ]),
            }));
        } catch (cause) {
            const messageText = cause instanceof Error ? cause.message : String(cause);
            error = messageText;
            composer.setNotice({
                color: THEME.error,
                text: "The last turn failed. Review the error or retry.",
            });
            streamingText = "";
            updateTurnById(turnId, (item) => ({
                ...item,
                assistantText: item.assistantText || `Error: ${messageText}`,
                completedAt: new Date().toISOString(),
                error: messageText,
            }));
        } finally {
            currentTurnId = null;
            processing = false;
            phase = "idle";
        }
    }

    // ── 键盘处理 ──────────────────────────────────────────

    function handleExit(): void {
        if (processing) {
            composer.setNotice({
                color: THEME.gold,
                text: "Wait for the current turn to finish before exiting.",
            });
            return;
        }
        const state = composer.getState();
        if (state.input.length > 0) {
            composer.clearInput();
            composer.setNotice({
                color: THEME.gold,
                text: "Input cleared. Press Ctrl+C again to confirm exit.",
            });
            exitArmed = true;
            return;
        }
        if (!exitArmed) {
            exitArmed = true;
            composer.setNotice({
                color: THEME.error,
                text: "Press Ctrl+C again to exit Flyflor chat.",
            });
            return;
        }
        screen.close();
    }

    const keyHandler = (key: KeyEvent): void => {
        const action = composer.handleKey(key, processing);
        const maxScr = maxScroll();

        switch (action) {
            case "submit":
                void handleSubmit();
                break;
            case "exit":
                handleExit();
                // exitArmed 由 handleExit 内部管理，不在 keyHandler 层重置
                return;
            case "clear":
                turns = [];
                error = null;
                scrollOffset = 0;
                break;
            case "scroll-up":
                scrollOffset = Math.max(0, scrollOffset - 1);
                break;
            case "scroll-down":
                scrollOffset = Math.min(scrollOffset + 1, maxScr);
                break;
            case "scroll-pageup":
                scrollOffset = Math.max(0, scrollOffset - 10);
                break;
            case "scroll-pagedown":
                scrollOffset = Math.min(scrollOffset + 10, maxScr);
                break;
            default:
                break;
        }
        // 仅非退出操作时清除 exit 待命状态
        exitArmed = false;
    };

    // ── 鼠标处理 ──────────────────────────────────────────

    function handleMouse(event: MouseEvent): void {
        const { rows, cols } = screen.getSize();
        const viewportTopRow = 3;
        const viewportHeight = rows - 10;
        const maxScr = maxScroll();

        if (event.row < viewportTopRow || event.row >= viewportTopRow + viewportHeight) return;

        if (event.button === 64) {
            scrollOffset = Math.max(0, scrollOffset - 3);
            return;
        }
        if (event.button === 65) {
            scrollOffset = Math.min(scrollOffset + 3, maxScr);
        }
    }

    // ── 事件总线 ──────────────────────────────────────────

    if (options.eventBus) {
        const sink: EventSink = {
            publish: (event: RuntimeEvent) => {
                const payload = readRecord(event.payload);
                if (event.type === RuntimeEventType.AgentTurnStart) {
                    phase = "thinking";
                } else if (event.type === RuntimeEventType.McpToolCallExecuted) {
                    const nextTrace = readMcpTrace(payload);
                    if (nextTrace && currentTurnId) {
                        updateTurnById(currentTurnId, (turn) => ({
                            ...turn,
                            mcpCalls: mergeTraces(turn.mcpCalls, [nextTrace]),
                        }));
                    }
                    phase = "mcp";
                } else if (
                    event.type === RuntimeEventType.BlackboardWorkerStart ||
                    event.type === RuntimeEventType.BlackboardWorkerEnd ||
                    event.type === RuntimeEventType.BlackboardMessageAppended
                ) {
                    phase = "blackboard";
                } else if (event.type === RuntimeEventType.SkillContextBuilt) {
                    phase = "skill";
                    const skillNames = readStringArray(payload?.skillNames);
                    if (skillNames.length > 0 && currentTurnId) {
                        updateTurnById(currentTurnId, (turn) => ({
                            ...turn,
                            skills: uniqueStrings([...turn.skills, ...skillNames]),
                        }));
                    }
                }
            },
        };
        options.eventBus.subscribe(sink);
    }

    // ── 初始化 ────────────────────────────────────────────

    screen.init();
    screen.onKey(keyHandler);
    screen.onMouse(handleMouse);

    // ── 渲染循环 ──────────────────────────────────────────

    let animFrame = 0;

    const renderFrame = () => {
        const { rows, cols } = screen.getSize();
        const showInspector = cols >= BREAKPOINT_INSPECTOR;
        const inspectorWidth = showInspector ? 38 : 0;
        const conversationWidth = showInspector ? Math.max(1, cols - inspectorWidth - 1) : cols;
        const viewportHeight = rows - 10;
        const viewWidth = Math.max(1, conversationWidth - 3);

        viewport.setGeometry({
            topRow: 3,
            height: viewportHeight,
            leftCol: 0,
            width: conversationWidth,
        });

        const allLines = buildAllLines(viewWidth);
        const maxScr = Math.max(0, allLines.length - viewportHeight);
        scrollOffset = Math.max(0, Math.min(scrollOffset, maxScr));

        const inspectorLines = buildInspectorLines(
            latestTurn(),
            error,
            phase,
            processing,
            scrollOffset,
            Math.max(1, inspectorWidth - 2),
        );

        // Header
        const phaseDef = PHASE_DEF[phase];
        const animIcon = processing
            ? phaseDef.frames[Math.floor(animFrame / 2) % phaseDef.frames.length] ?? phaseDef.done
            : "▪";
        const headerColor = processing ? phaseDef.color : THEME.cyanSoft;

        screen.clearRange(0, 3);
        screen.writeLine(0, {
            text: `╭${"─".repeat(Math.max(0, cols - 2))}╮`,
            color: headerColor,
        });
        screen.writeLine(1, {
            text: `│ ${animIcon} ${agentName} · ${processing ? phaseDef.label : "ready"} · ${turns.length} turns · q/Ctrl+C exit │`,
            color: headerColor,
        });
        screen.writeLine(2, {
            text: `╰${"─".repeat(Math.max(0, cols - 2))}╯`,
            color: headerColor,
        });

        // Viewport
        viewport.render(screen, allLines, scrollOffset);

        // Inspector
        if (showInspector) {
            panel.render(screen, inspectorLines, 3, viewportHeight, inspectorWidth);
        }

        // Composer
        composer.render(screen, rows - 4, cols, phase, processing, agentName);

        screen.flush();
    };

    // 动画定时器
    const animTimer = setInterval(() => {
        if (processing) {
            animFrame += 1;
        }
    }, ANIM_FRAME_MS);

    // 主帧循环
    let lastRenderChecksum = -1;

    const frameLoop = setInterval(() => {
        const state = composer.getState();
        const newChecksum =
            turns.length * 10000 +
            (processing ? 1 : 0) +
            state.input.length * 100 +
            state.cursor * 10 +
            animFrame;

        if (newChecksum !== lastRenderChecksum) {
            lastRenderChecksum = newChecksum;
            renderFrame();
        }
    }, FRAME_MS);

    screen.onResize(() => {
        renderFrame();
        lastRenderChecksum = -1;
    });

    screen.onClose(() => {
        clearInterval(animTimer);
        clearInterval(frameLoop);
    });

    await new Promise<void>((resolve) => {
        screen.onClose(resolve);
    });
}

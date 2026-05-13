/**
 * 通用渲染工具函数 —— 从 chat.tui.tsx 提取，供新旧 TUI 共用。
 *
 * 职责：文本宽度计算、换行、ViewLine 构建、Markdown→纯文本。
 * 不依赖 React/Ink，纯 TypeScript。
 */

import { renderMarkdownToPlainText } from "../../render/index.ts";

// ── 颜色主题 ──────────────────────────────────────────────

export type ToneColor = string;

export const THEME = {
    bg: "#0B1020",
    border: "#98A3C7",
    cyan: "#6FE7FF",
    cyanSoft: "#79E6FF",
    error: "#FF7EA8",
    gold: "#D8B36A",
    iris: "#6C63FF",
    mint: "#8EDBB5",
    muted: "#98A3C7",
    panel: "#141A31",
    panelAlt: "#1B223D",
    pink: "#F3A6D6",
    silver: "#EAEAF6",
    violet: "#C78BFF",
} as const;

// ── 阶段定义 ──────────────────────────────────────────────

export type Phase = "idle" | "blackboard" | "thinking" | "mcp" | "skill" | "streaming";

export interface PhaseDef {
    color: ToneColor;
    done: string;
    frames: string[];
    label: string;
}

export const PHASE_DEF: Record<Phase, PhaseDef> = {
    idle: { color: THEME.muted, done: "○", frames: ["○"], label: "IDLE" },
    blackboard: { color: THEME.violet, done: "◆", frames: ["◇", "◆", "◇"], label: "BLACKBOARD" },
    thinking: { color: THEME.cyan, done: "◆", frames: ["◐", "◓", "◑", "◒"], label: "THINKING" },
    mcp: { color: THEME.cyanSoft, done: "◆", frames: ["▣", "■", "▣"], label: "TOOLS" },
    skill: { color: THEME.pink, done: "◆", frames: ["◈", "◆", "◈"], label: "SKILLS" },
    streaming: { color: THEME.silver, done: "◆", frames: ["•", "◦", "•"], label: "STREAMING" },
};

// ── 视图行类型 ────────────────────────────────────────────

export interface ViewLine {
    bold?: boolean;
    color?: ToneColor;
    dim?: boolean;
    text: string;
}

// ── 回合类型 ──────────────────────────────────────────────

export interface McpTrace {
    server: string;
    tool: string;
    ok: boolean;
    resultText: string;
}

export interface BlackboardMeta {
    elapsedMs?: number;
    messages?: number;
    mode: string;
    reason?: string;
    status?: string;
    turnId?: string;
}

export interface Turn {
    id: string;
    assistantText: string;
    blackboard: BlackboardMeta | null;
    blackboardTurn: Record<string, unknown> | null;
    completedAt: string | null;
    error: string | null;
    mcpCalls: McpTrace[];
    metadata: Record<string, unknown> | null;
    skills: string[];
    startedAt: string;
    userMessage: string;
}

// ── 字符宽度计算（CJK 宽字符支持）───────────────────────

function isWideCodePoint(codePoint: number): boolean {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115f) ||
        (codePoint >= 0x2329 && codePoint <= 0x232a) ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    );
}

export function charDisplayWidth(character: string): number {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return 0;
    return isWideCodePoint(codePoint) ? 2 : 1;
}

export function stringDisplayWidth(value: string): number {
    let width = 0;
    for (const character of value) {
        width += charDisplayWidth(character);
    }
    return width;
}

// ── 文本截断与填充（基于 display width）─────────────────

export function sliceByDisplayWidth(value: string, width: number): string {
    if (width <= 0) return "";
    let currentWidth = 0;
    let output = "";
    for (const character of value) {
        const nextWidth = currentWidth + charDisplayWidth(character);
        if (nextWidth > width) break;
        output += character;
        currentWidth = nextWidth;
    }
    return output;
}

export function takeRightByDisplayWidth(value: string, width: number): string {
    if (width <= 0 || value.length === 0) return "";
    const characters = Array.from(value);
    let currentWidth = 0;
    let output = "";
    for (let index = characters.length - 1; index >= 0; index -= 1) {
        const character = characters[index];
        if (!character) continue;
        const nextWidth = currentWidth + charDisplayWidth(character);
        if (nextWidth > width) break;
        output = `${character}${output}`;
        currentWidth = nextWidth;
    }
    return output;
}

export function padDisplayText(value: string, width: number): string {
    const current = stringDisplayWidth(value);
    if (current >= width) return value;
    return `${value}${" ".repeat(width - current)}`;
}

export function truncateDisplayText(value: string, width: number): string {
    if (stringDisplayWidth(value) <= width) return value;
    if (width <= 1) return "…";
    return `${sliceByDisplayWidth(value, width - 1)}…`;
}

// ── 文本换行 ──────────────────────────────────────────────

export function wrapDisplayText(value: string, width: number): string[] {
    if (width <= 0) return [""];
    const asciiOnly = !/[^\x00-\x7F]/.test(value);
    const output: string[] = [];
    for (const rawLine of value.split("\n")) {
        if (rawLine.length === 0) {
            output.push("");
            continue;
        }
        if (asciiOnly) {
            for (let i = 0; i < rawLine.length; i += width) {
                output.push(rawLine.slice(i, i + width));
            }
        } else {
            let remaining = rawLine;
            while (remaining.length > 0) {
                const next = sliceByDisplayWidth(remaining, width);
                if (next.length === 0) break;
                output.push(next);
                remaining = remaining.slice(next.length);
            }
        }
    }
    return output.length > 0 ? output : [""];
}

// ── ViewLine 辅助 ─────────────────────────────────────────

export function appendWrappedViewLines(
    lines: ViewLine[],
    text: string,
    width: number,
    style: Omit<ViewLine, "text">,
    firstPrefix = "",
    nextPrefix = firstPrefix,
): void {
    const effectiveWidth = Math.max(
        1,
        width - Math.max(stringDisplayWidth(firstPrefix), stringDisplayWidth(nextPrefix)),
    );
    const wrapped = wrapDisplayText(text, effectiveWidth);
    wrapped.forEach((line, index) => {
        lines.push({
            ...style,
            text: `${index === 0 ? firstPrefix : nextPrefix}${line}`,
        });
    });
}

// ── 时间格式化 ────────────────────────────────────────────

export function fmtTime(iso: string | null | undefined): string {
    if (!iso) return "--:--";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "--:--";
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export function formatRelativeTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return value;
    const delta = Date.now() - time;
    const abs = Math.abs(delta);
    if (abs < 1_000) return "now";
    if (abs < 60_000) return `${Math.round(abs / 1_000)}s ago`;
    if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
    return `${Math.round(abs / 3_600_000)}h ago`;
}

// ── 辅助 ──────────────────────────────────────────────────

export function truncate(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

export function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const value of values) {
        if (value.length === 0 || seen.has(value)) continue;
        seen.add(value);
        items.push(value);
    }
    return items;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

// ── 二级构建器：从 Turn 构建 ViewLine[] ───────────────────

export function buildTraceLine(
    turn: Turn,
    isActive: boolean,
    phase: Phase,
    minimalMode: boolean,
    detailFolded: boolean,
): string {
    const skills = readSkillNames(turn);
    const tools = readToolCount(turn);
    const route = turn.blackboard?.mode ?? "direct";
    const labels = [
        isActive && phase === "thinking" ? "[• think]" : "[think]",
        turn.blackboard?.mode === "blackboard" ? "[board]" : "[board:direct]",
        `[skill${skills.length > 0 ? `×${skills.length}` : ""}]`,
        `[tool${tools > 0 ? `×${tools}` : ""}]`,
        isActive && phase === "streaming" ? "[• write]" : "[write]",
        `[route:${route}]`,
    ];
    if (!minimalMode) {
        labels.push(`[details:${detailFolded ? "closed" : "open"}]`);
    }
    return labels.join(" ");
}

export function readSkillNames(turn: Turn): string[] {
    return uniqueStrings([...turn.skills, ...readStringArray(readRecord(turn.metadata)?.skills)]);
}

export function readToolCount(turn: Turn): number {
    const metadataCount = readNumber(readRecord(turn.metadata)?.mcpToolCalls) ?? 0;
    return Math.max(metadataCount, turn.mcpCalls.length);
}

export function readBlackboardMeta(
    metadata: Record<string, unknown> | null | undefined,
): BlackboardMeta | null {
    const source = readRecord(readRecord(metadata)?.blackboard);
    const mode = readString(source?.mode);
    if (!mode) return null;
    return {
        elapsedMs: readNumber(source?.elapsedMs),
        messages: readNumber(source?.messages),
        mode,
        reason: readString(source?.reason),
        status: readString(source?.status),
        turnId: readString(source?.turnId),
    };
}

// ── 对话行构建 ────────────────────────────────────────────

export function buildConversationLines(
    turns: Turn[],
    width: number,
    minimalMode: boolean,
): ViewLine[] {
    const lines: ViewLine[] = [];

    if (turns.length === 0) {
        return [
            { bold: true, color: THEME.silver, text: "Start a turn" },
            { color: THEME.muted, text: "Ask a question, request a task, or inspect runtime details." },
            { color: THEME.muted, text: "Press Enter to send · Ctrl+C to clear / confirm exit" },
        ];
    }

    for (let ti = 0; ti < turns.length; ti += 1) {
        const turn = turns[ti];
        if (!turn) continue;
        const isLast = ti === turns.length - 1;
        const hasError = Boolean(turn.error);

        lines.push({ bold: true, color: THEME.cyanSoft, text: `◈ You ${fmtTime(turn.startedAt)}` });
        appendWrappedViewLines(lines, renderMarkdownToPlainText(turn.userMessage), width, { color: THEME.silver }, "  ");

        lines.push({
            color: THEME.muted,
            dim: true,
            text: buildTraceLine(turn, false, "idle", minimalMode, true),
        });

        lines.push({
            bold: true,
            color: hasError ? THEME.error : THEME.silver,
            text: `◆ Flyflor ${fmtTime(turn.completedAt ?? turn.startedAt)} [${hasError ? "ERROR" : "DONE"}]`,
        });
        appendWrappedViewLines(
            lines,
            turn.assistantText.length > 0 ? renderMarkdownToPlainText(turn.assistantText) : " ",
            width,
            { color: THEME.silver },
            "  ",
        );

        if (turn.error) {
            appendWrappedViewLines(lines, turn.error, width, { color: THEME.error }, "  ! ");
        }

        if (!isLast) {
            lines.push({ color: THEME.border, text: "─".repeat(Math.max(4, width - 2)) });
        }
    }

    return lines;
}

export function buildStreamingLines(
    turn: Turn,
    streamingText: string,
    width: number,
    phase: Phase,
): ViewLine[] {
    const phaseDef = PHASE_DEF[phase];
    const text = streamingText || turn.assistantText;
    const lines: ViewLine[] = [];

    lines.push({ bold: true, color: THEME.cyanSoft, text: `◈ You ${fmtTime(turn.startedAt)}` });
    appendWrappedViewLines(lines, renderMarkdownToPlainText(turn.userMessage), width, { color: THEME.silver }, "  ");
    lines.push({
        color: THEME.muted,
        dim: true,
        text: `[think] [write] [route:${turn.blackboard?.mode ?? "direct"}]`,
    });

    lines.push({ bold: true, color: phaseDef.color, text: `◆ Flyflor ${fmtTime(turn.startedAt)} [${phaseDef.label}]` });

    if (text.length > 0) {
        const wrapped = wrapDisplayText(text, Math.max(1, width - 2));
        for (const w of wrapped) {
            lines.push({ color: THEME.silver, text: `  ${w}` });
        }
    } else {
        lines.push({ color: THEME.muted, text: `  ${phaseDef.label.toLowerCase()}…` });
    }

    return lines;
}

// ── Inspector 行构建 ──────────────────────────────────────

export function buildInspectorLines(
    turn: Turn | null,
    errorText: string | null,
    phase: Phase,
    processing: boolean,
    scrollOffset: number,
    width: number,
): ViewLine[] {
    const lines: ViewLine[] = [];

    lines.push({ color: THEME.violet, bold: true, text: "◆ Current turn" });
    if (!turn) {
        lines.push({ color: THEME.muted, dim: true, text: "  No turns yet." });
    } else {
        const latestActivityAt = turn.completedAt ?? turn.startedAt;
        appendWrappedViewLines(
            lines,
            `phase ${processing ? phase : "idle"} · ${latestActivityAt ? formatRelativeTime(latestActivityAt) : "now"}`,
            width,
            { color: THEME.silver },
            "  ",
        );
        appendWrappedViewLines(
            lines,
            `route ${turn.blackboard?.mode ?? "direct"} · view ${scrollOffset > 0 ? "SCROLLED" : "LIVE"}`,
            width,
            { color: THEME.muted, dim: true },
            "  ",
        );
        if (turn.blackboard?.status) {
            appendWrappedViewLines(lines, `blackboard ${turn.blackboard.status}`, width, { color: THEME.violet }, "  ");
        }
        if (turn.blackboard?.reason) {
            appendWrappedViewLines(lines, turn.blackboard.reason, width, { color: THEME.muted, dim: true }, "  ");
        }
        if (errorText) {
            appendWrappedViewLines(lines, `last error ${errorText}`, width, { color: THEME.error }, "  ");
        }
    }

    lines.push({ text: "" });
    lines.push({ color: THEME.pink, bold: true, text: "◇ Skills" });
    const skills = turn ? readSkillNames(turn).slice(-5) : [];
    if (skills.length === 0) {
        lines.push({ color: THEME.muted, dim: true, text: "  No skills in latest turn." });
    } else {
        for (const skill of skills) {
            appendWrappedViewLines(lines, skill, width, { color: THEME.muted, dim: true }, "  • ");
        }
    }

    lines.push({ text: "" });
    lines.push({ color: THEME.cyanSoft, bold: true, text: "◇ Latest tools" });
    const tools = turn?.mcpCalls.slice(-4) ?? [];
    if (tools.length === 0) {
        lines.push({ color: THEME.muted, dim: true, text: "  No tool calls in latest turn." });
    } else {
        for (const tool of tools) {
            appendWrappedViewLines(
                lines,
                `${tool.ok ? "✓" : "✗"} ${tool.server}.${tool.tool}`,
                width,
                { color: tool.ok ? THEME.mint : THEME.error },
                "  ",
            );
        }
    }

    lines.push({ text: "" });
    lines.push({ color: THEME.cyan, bold: true, text: "◇ Hotkeys" });
    const hotkeys = [
        "Tab toggle details",
        "Ctrl+B blackboard",
        "Ctrl+T tools",
        "Ctrl+S skills",
        "↑↓ PgUp PgDn scroll",
        "Ctrl+C clear / exit",
    ];
    for (const shortcut of hotkeys) {
        appendWrappedViewLines(lines, shortcut, width, { color: THEME.muted, dim: true }, "  • ");
    }

    return lines;
}

// ── 输入窗口节取 ──────────────────────────────────────────

export function buildInputWindow(
    input: string,
    cursor: number,
    limit: number,
): { after: string; before: string; clippedLeft: boolean; clippedRight: boolean } {
    const beforeCursor = input.slice(0, cursor);
    const afterCursor = input.slice(cursor);
    if (stringDisplayWidth(input) <= limit) {
        return { after: afterCursor, before: beforeCursor, clippedLeft: false, clippedRight: false };
    }

    let before = takeRightByDisplayWidth(beforeCursor, Math.max(0, Math.floor(limit * 0.6)));
    let after = takeRightByDisplayWidth(afterCursor, Math.max(0, limit - stringDisplayWidth(before)));
    const usedWidth = stringDisplayWidth(before) + stringDisplayWidth(after);
    if (usedWidth < limit) {
        before = takeRightByDisplayWidth(beforeCursor, limit - stringDisplayWidth(after));
    }
    return {
        after,
        before,
        clippedLeft: before.length < beforeCursor.length,
        clippedRight: after.length < afterCursor.length,
    };
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import type { GatewayMessage, GatewayReply, RuntimeContext, RuntimeEvent } from "../../protocol/contracts/index.ts";
import { Channel, ChatType } from "../../protocol/contracts/index.ts";
import { RuntimeEventBus, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import type { BlackboardMessage, BlackboardModule, BlackboardStep, BlackboardTurn } from "../../agent/blackboard/index.ts";
import type { RuntimeModule } from "../../agent/runtime/index.ts";
import type { McpToolCallRequest } from "../../agent/mcp/index.ts";
import { renderMarkdownToPlainText } from "../render/index.ts";

type ToneColor = string;
type Phase = "idle" | "blackboard" | "thinking" | "mcp" | "skill" | "streaming";
type Section = "blackboard" | "skills" | "mcp" | "metadata";
type SectionMap = Record<Section, boolean>;

interface McpTrace {
    server: string;
    tool: string;
    ok: boolean;
    resultText: string;
}

interface BlackboardMeta {
    elapsedMs?: number;
    messages?: number;
    mode: string;
    reason?: string;
    status?: string;
    turnId?: string;
}

interface Turn {
    id: string;
    assistantText: string;
    blackboard: BlackboardMeta | null;
    blackboardTurn: BlackboardTurn | null;
    completedAt: string | null;
    error: string | null;
    mcpCalls: McpTrace[];
    metadata: GatewayReply["metadata"] | null;
    skills: string[];
    startedAt: string;
    userMessage: string;
}

interface PhaseDef {
    color: ToneColor;
    done: string;
    frames: string[];
    label: string;
}

interface ChatTuiProps {
    runtime: RuntimeModule;
    blackboard?: BlackboardModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    userId?: string;
}

interface BadgeProps {
    color?: ToneColor;
    dim?: boolean;
    label: string;
}

interface TraceChipProps {
    color: ToneColor;
    count?: number;
    label: string;
    state: "active" | "done" | "error" | "idle";
}

interface DetailSectionProps {
    color?: ToneColor;
    title: string;
    children?: React.ReactNode;
}

interface NoticeState {
    color: ToneColor;
    kind: "exit" | "runtime";
    text: string;
}

interface ViewLine {
    bold?: boolean;
    color?: ToneColor;
    dim?: boolean;
    text: string;
}

interface TurnCardProps {
    turn: Turn;
    expanded: SectionMap;
    isActive: boolean;
    isLatest: boolean;
    minimalMode: boolean;
    phase: Phase;
}

const SECTION_ORDER: Section[] = ["blackboard", "skills", "mcp", "metadata"];
const BREAKPOINT_INSPECTOR = 140;
const BREAKPOINT_COMPACT = 100;
const BREAKPOINT_MINIMAL = 80;

const THEME = {
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

const PHASE_DEF: Record<Phase, PhaseDef> = {
    idle: { color: THEME.muted, done: "○", frames: ["○"], label: "IDLE" },
    blackboard: { color: THEME.violet, done: "◆", frames: ["◇", "◆", "◇"], label: "BLACKBOARD" },
    thinking: { color: THEME.cyan, done: "◆", frames: ["◐", "◓", "◑", "◒"], label: "THINKING" },
    mcp: { color: THEME.cyanSoft, done: "◆", frames: ["▣", "■", "▣"], label: "TOOLS" },
    skill: { color: THEME.pink, done: "◆", frames: ["◈", "◆", "◈"], label: "SKILLS" },
    streaming: { color: THEME.silver, done: "◆", frames: ["•", "◦", "•"], label: "STREAMING" },
};

function useAnim(active: boolean, frames: string[], intervalMs = 220): string {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (!active || frames.length <= 1) {
            setIndex(0);
            return;
        }
        const timer = setInterval(() => setIndex((value) => (value + 1) % frames.length), intervalMs);
        return () => clearInterval(timer);
    }, [active, frames, intervalMs]);
    return frames[index] ?? frames[0] ?? "";
}

function useTermSize(): { rows: number; cols: number } {
    const { stdout } = useStdout();
    const [size, setSize] = useState({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });

    useEffect(() => {
        const update = (): void => {
            setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
        };
        stdout.on("resize", update);
        return () => {
            stdout.off("resize", update);
        };
    }, [stdout]);

    return size;
}

function c(color: ToneColor): ToneColor {
    return color;
}

function emptySections(): SectionMap {
    return {
        blackboard: false,
        metadata: false,
        mcp: false,
        skills: false,
    };
}

function toggleAllSections(value: SectionMap): SectionMap {
    const nextOpen = !SECTION_ORDER.every((section) => value[section]);
    return {
        blackboard: nextOpen,
        metadata: nextOpen,
        mcp: nextOpen,
        skills: nextOpen,
    };
}

function updateTurnById(turns: Turn[], turnId: string | null, recipe: (turn: Turn) => Turn): Turn[] {
    if (!turnId) {
        return turns;
    }
    return turns.map((turn) => (turn.id === turnId ? recipe(turn) : turn));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const value of values) {
        if (value.length === 0 || seen.has(value)) {
            continue;
        }
        seen.add(value);
        items.push(value);
    }
    return items;
}

function readBlackboardMeta(metadata: GatewayReply["metadata"] | null | undefined): BlackboardMeta | null {
    const source = readRecord(readRecord(metadata)?.blackboard);
    const mode = readString(source?.mode);
    if (!mode) {
        return null;
    }
    return {
        elapsedMs: readNumber(source?.elapsedMs),
        messages: readNumber(source?.messages),
        mode,
        reason: readString(source?.reason),
        status: readString(source?.status),
        turnId: readString(source?.turnId),
    };
}

function readMcpExecutions(metadata: GatewayReply["metadata"] | null | undefined): McpTrace[] {
    const source = readRecord(metadata);
    const executions = source?.mcpToolExecutions;
    if (!Array.isArray(executions)) {
        return [];
    }
    return executions
        .map((entry) => readRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({
            ok: entry.ok === true,
            resultText: readString(entry.resultSummary) ?? readString(entry.resultText) ?? "",
            server: readString(entry.server) ?? "",
            tool: readString(entry.tool) ?? "",
        }));
}

function mergeMcpTraces(primary: McpTrace[], secondary: McpTrace[]): McpTrace[] {
    const seen = new Set<string>();
    const merged: McpTrace[] = [];
    for (const trace of [...primary, ...secondary]) {
        const key = JSON.stringify([trace.server, trace.tool, trace.ok, trace.resultText]);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        merged.push(trace);
    }
    return merged;
}

function readMetadataSkills(metadata: GatewayReply["metadata"] | null | undefined): string[] {
    return readStringArray(readRecord(metadata)?.skills);
}

function readToolCount(turn: Turn): number {
    const metadataCount = readNumber(readRecord(turn.metadata)?.mcpToolCalls) ?? 0;
    return Math.max(metadataCount, turn.mcpCalls.length);
}

function readSkillNames(turn: Turn): string[] {
    return uniqueStrings([...turn.skills, ...readMetadataSkills(turn.metadata)]);
}

function hasAnyDetails(expanded: SectionMap): boolean {
    return SECTION_ORDER.some((section) => expanded[section]);
}

function fmtTime(iso: string | null | undefined): string {
    if (!iso) {
        return "--:--";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "--:--";
    }
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function formatRelativeTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
        return value;
    }
    const delta = Date.now() - time;
    const abs = Math.abs(delta);
    if (abs < 1_000) {
        return "now";
    }
    if (abs < 60_000) {
        return `${Math.round(abs / 1_000)}s ago`;
    }
    if (abs < 3_600_000) {
        return `${Math.round(abs / 60_000)}m ago`;
    }
    return `${Math.round(abs / 3_600_000)}h ago`;
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) {
        return value;
    }
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function formatDuration(ms: number | undefined): string | undefined {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
        return undefined;
    }
    if (ms < 1_000) {
        return `${ms}ms`;
    }
    return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function titleCase(value: string): string {
    return value
        .split(/[\s._-]+/u)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

function readStepOutcome(step: BlackboardStep): string {
    const metadata = readRecord(step.metadata);
    return readString(metadata?.qaOutcome) ?? "unknown";
}

function stepTone(step: BlackboardStep): ToneColor {
    const outcome = readStepOutcome(step);
    if (outcome === "final") {
        return THEME.mint;
    }
    if (outcome === "blocked") {
        return THEME.error;
    }
    if (outcome === "continue") {
        return THEME.gold;
    }
    return THEME.muted;
}

function stepBullet(step: BlackboardStep): string {
    const outcome = readStepOutcome(step);
    if (outcome === "final") {
        return "●";
    }
    if (outcome === "blocked") {
        return "△";
    }
    return "•";
}

function isReadableBlackboardMessage(message: BlackboardMessage): boolean {
    return message.visibility === "public" && !message.content.includes("flyflor-decision-form");
}

function speakerForMessage(turn: BlackboardTurn, message: BlackboardMessage): string {
    if (!message.workerRole) {
        return message.role === "system" ? "Blackboard" : titleCase(message.role);
    }
    const worker = turn.workers.find((item) => item.role === message.workerRole);
    return worker?.name ?? titleCase(message.workerRole);
}

function metadataLines(metadata: GatewayReply["metadata"] | null): string[] {
    const source = readRecord(metadata);
    if (!source) {
        return [];
    }
    return Object.entries(source)
        .map(([key, value]) => {
            if (Array.isArray(value)) {
                return `${key}: ${truncate(value.map((item) => JSON.stringify(item)).join(", "), 140)}`;
            }
            if (typeof value === "object" && value !== null) {
                return `${key}: ${truncate(JSON.stringify(value), 140)}`;
            }
            return `${key}: ${String(value)}`;
        })
        .slice(0, 8);
}

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

function charDisplayWidth(character: string): number {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
        return 0;
    }
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
        return 0;
    }
    return isWideCodePoint(codePoint) ? 2 : 1;
}

function stringDisplayWidth(value: string): number {
    let width = 0;
    for (const character of value) {
        width += charDisplayWidth(character);
    }
    return width;
}

function sliceByDisplayWidth(value: string, width: number): string {
    if (width <= 0) {
        return "";
    }
    let currentWidth = 0;
    let output = "";
    for (const character of value) {
        const nextWidth = currentWidth + charDisplayWidth(character);
        if (nextWidth > width) {
            break;
        }
        output += character;
        currentWidth = nextWidth;
    }
    return output;
}

function takeLeftByDisplayWidth(value: string, width: number): string {
    if (width <= 0 || value.length === 0) {
        return "";
    }
    let currentWidth = 0;
    let output = "";
    for (const character of value) {
        const nextWidth = currentWidth + charDisplayWidth(character);
        if (nextWidth > width) {
            break;
        }
        output += character;
        currentWidth = nextWidth;
    }
    return output;
}

function takeRightByDisplayWidth(value: string, width: number): string {
    if (width <= 0 || value.length === 0) {
        return "";
    }
    const characters = Array.from(value);
    let currentWidth = 0;
    let output = "";
    for (let index = characters.length - 1; index >= 0; index -= 1) {
        const character = characters[index];
        if (!character) {
            continue;
        }
        const nextWidth = currentWidth + charDisplayWidth(character);
        if (nextWidth > width) {
            break;
        }
        output = `${character}${output}`;
        currentWidth = nextWidth;
    }
    return output;
}

function padDisplayText(value: string, width: number): string {
    const current = stringDisplayWidth(value);
    if (current >= width) {
        return value;
    }
    return `${value}${" ".repeat(width - current)}`;
}

function truncateDisplayText(value: string, width: number): string {
    if (stringDisplayWidth(value) <= width) {
        return value;
    }
    if (width <= 1) {
        return "…";
    }
    return `${sliceByDisplayWidth(value, width - 1)}…`;
}

function wrapDisplayText(value: string, width: number): string[] {
    if (width <= 0) {
        return [""];
    }
    const output: string[] = [];
    for (const rawLine of value.split("\n")) {
        if (rawLine.length === 0) {
            output.push("");
            continue;
        }
        let remaining = rawLine;
        while (remaining.length > 0) {
            const next = sliceByDisplayWidth(remaining, width);
            if (next.length === 0) {
                break;
            }
            output.push(next);
            remaining = remaining.slice(next.length);
        }
    }
    return output.length > 0 ? output : [""];
}

function appendWrappedViewLines(
    lines: ViewLine[],
    text: string,
    width: number,
    style: Omit<ViewLine, "text">,
    firstPrefix = "",
    nextPrefix = firstPrefix,
): void {
    const effectiveWidth = Math.max(1, width - Math.max(stringDisplayWidth(firstPrefix), stringDisplayWidth(nextPrefix)));
    const wrapped = wrapDisplayText(text, effectiveWidth);
    wrapped.forEach((line, index) => {
        lines.push({
            ...style,
            text: `${index === 0 ? firstPrefix : nextPrefix}${line}`,
        });
    });
}

function buildTraceLine(turn: Turn, isActive: boolean, phase: Phase, minimalMode: boolean, expanded: SectionMap): string {
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
        labels.push(`[details:${hasAnyDetails(expanded) ? "open" : "closed"}]`);
    }
    return labels.join(" ");
}

function buildBlackboardDetailLines(blackboard: BlackboardMeta | null, turn: BlackboardTurn | null, width: number): ViewLine[] {
    const lines: ViewLine[] = [];
    if (!blackboard && !turn) {
        lines.push({ color: THEME.violet, text: "◇ Blackboard" });
        lines.push({ color: THEME.muted, dim: true, text: "  No structured blackboard trace." });
        return lines;
    }

    lines.push({ color: THEME.violet, bold: true, text: "◇ Blackboard" });
    if (blackboard) {
        const summary = [
            `mode ${blackboard.mode}`,
            blackboard.status ? `status ${blackboard.status}` : "",
            blackboard.messages ? `messages ${blackboard.messages}` : "",
            formatDuration(blackboard.elapsedMs) ? `elapsed ${formatDuration(blackboard.elapsedMs)}` : "",
        ]
            .filter(Boolean)
            .join(" · ");
        appendWrappedViewLines(lines, summary, width, { color: THEME.muted, dim: true }, "  ");
        if (blackboard.reason) {
            appendWrappedViewLines(lines, `reason ${blackboard.reason}`, width, { color: THEME.muted, dim: true }, "  ");
        }
    }

    for (const step of turn?.steps.slice(-3) ?? []) {
        appendWrappedViewLines(
            lines,
            `${stepBullet(step)} round ${step.round} · ${titleCase(step.workerRole)} · ${readStepOutcome(step)}`,
            width,
            { color: stepTone(step) },
            "  ",
        );
        appendWrappedViewLines(lines, renderMarkdownToPlainText(step.outputSummary), width, { color: THEME.muted, dim: true }, "    ");
        if (step.blockers.length > 0) {
            appendWrappedViewLines(lines, `blockers ${step.blockers.join(" · ")}`, width, { color: THEME.gold }, "    ");
        }
        if (step.newFacts.length > 0) {
            appendWrappedViewLines(lines, `facts ${step.newFacts.join(" · ")}`, width, { color: THEME.mint }, "    ");
        }
    }

    for (const message of (turn?.messages.filter(isReadableBlackboardMessage) ?? []).slice(-3)) {
        appendWrappedViewLines(
            lines,
            `${speakerForMessage(turn!, message)}: ${renderMarkdownToPlainText(message.content).replace(/\s+/gu, " ")}`,
            width,
            { color: THEME.muted, dim: true },
            "  ",
        );
    }

    return lines;
}

function buildSkillsDetailLines(skills: string[], width: number): ViewLine[] {
    const lines: ViewLine[] = [{ color: THEME.pink, bold: true, text: "◇ Skills" }];
    if (skills.length === 0) {
        lines.push({ color: THEME.muted, dim: true, text: "  No skills loaded." });
        return lines;
    }
    for (const skill of skills) {
        appendWrappedViewLines(lines, skill, width, { color: THEME.muted, dim: true }, "  • ");
    }
    return lines;
}

function buildToolDetailLines(tools: McpTrace[], width: number): ViewLine[] {
    const lines: ViewLine[] = [{ color: THEME.cyanSoft, bold: true, text: "◇ Tools" }];
    if (tools.length === 0) {
        lines.push({ color: THEME.muted, dim: true, text: "  No tool calls recorded." });
        return lines;
    }
    for (const tool of tools) {
        appendWrappedViewLines(
            lines,
            `${tool.ok ? "✓" : "✗"} ${tool.server}.${tool.tool}`,
            width,
            { color: tool.ok ? THEME.mint : THEME.error },
            "  ",
        );
        if (tool.resultText) {
            appendWrappedViewLines(
                lines,
                renderMarkdownToPlainText(tool.resultText).replace(/\s+/gu, " "),
                width,
                { color: THEME.muted, dim: true },
                "    ",
            );
        }
    }
    return lines;
}

function buildMetadataDetailLines(metadata: GatewayReply["metadata"] | null, width: number): ViewLine[] {
    const lines: ViewLine[] = [{ color: THEME.gold, bold: true, text: "◇ Metadata" }];
    const meta = metadataLines(metadata);
    if (meta.length === 0) {
        lines.push({ color: THEME.muted, dim: true, text: "  No metadata." });
        return lines;
    }
    for (const line of meta) {
        appendWrappedViewLines(lines, line, width, { color: THEME.muted, dim: true }, "  ");
    }
    return lines;
}

function buildInspectorLines(
    turn: Turn | null,
    error: string | null,
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
            `route ${turn.blackboard?.mode ?? "direct"} · session ${scrollOffset > 0 ? "SCROLLED" : "LIVE"}`,
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
        if (error) {
            appendWrappedViewLines(lines, `last error ${error}`, width, { color: THEME.error }, "  ");
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

function buildConversationLines(
    turns: Turn[],
    width: number,
    latestTurnId: string | null,
    expanded: Map<string, SectionMap>,
    minimalMode: boolean,
    phase: Phase,
    processing: boolean,
): ViewLine[] {
    const lines: ViewLine[] = [];

    if (turns.length === 0) {
        return [
            { bold: true, color: THEME.silver, text: "Start an agent session" },
            { color: THEME.muted, text: "Ask a question, request a task, or inspect runtime details with Tab." },
            { color: THEME.muted, text: "Press Enter to send • Ctrl+C to clear / confirm exit" },
        ];
    }

    for (const turn of turns) {
        const isLatest = turn.id === latestTurnId;
        const isActive = processing && isLatest;
        const currentPhase = isActive ? phase : "idle";
        const phaseDef = PHASE_DEF[currentPhase];
        const detailState = expanded.get(turn.id) ?? emptySections();
        const skills = readSkillNames(turn);

        lines.push({
            bold: true,
            color: THEME.cyanSoft,
            text: `◈ You ${fmtTime(turn.startedAt)}`,
        });
        appendWrappedViewLines(lines, renderMarkdownToPlainText(turn.userMessage), width, { color: THEME.silver }, "  ");
        lines.push({
            color: THEME.muted,
            dim: true,
            text: buildTraceLine(turn, isActive, phase, minimalMode, detailState),
        });

        lines.push({
            bold: true,
            color: turn.error ? THEME.error : isActive ? phaseDef.color : THEME.silver,
            text: `◆ Feihua ${fmtTime(turn.completedAt ?? turn.startedAt)} [${turn.error ? "ERROR" : isActive ? PHASE_DEF[phase].label : "DONE"}]`,
        });
        appendWrappedViewLines(
            lines,
            turn.assistantText.length > 0
                ? renderMarkdownToPlainText(turn.assistantText)
                : isActive
                  ? `${PHASE_DEF[phase].label.toLowerCase()}…`
                  : " ",
            width,
            { color: THEME.silver },
            "  ",
        );

        if (turn.error) {
            appendWrappedViewLines(lines, `error ${turn.error}`, width, { color: THEME.error }, "  ");
        }

        if (detailState.blackboard) {
            lines.push(...buildBlackboardDetailLines(turn.blackboard, turn.blackboardTurn, width));
        }
        if (detailState.skills) {
            lines.push(...buildSkillsDetailLines(skills, width));
        }
        if (detailState.mcp) {
            lines.push(...buildToolDetailLines(turn.mcpCalls, width));
        }
        if (detailState.metadata) {
            lines.push(...buildMetadataDetailLines(turn.metadata, width));
        }

        if (turn !== turns.at(-1)) {
            lines.push({ color: THEME.border, text: "─".repeat(Math.max(4, width - 2)) });
        }
    }

    return lines;
}

function buildInputWindow(
    input: string,
    cursor: number,
    limit: number,
): { after: string; before: string; clippedLeft: boolean; clippedRight: boolean } {
    const beforeCursor = input.slice(0, cursor);
    const afterCursor = input.slice(cursor);
    if (stringDisplayWidth(input) <= limit) {
        return {
            after: afterCursor,
            before: beforeCursor,
            clippedLeft: false,
            clippedRight: false,
        };
    }

    let before = takeRightByDisplayWidth(beforeCursor, Math.max(0, Math.floor(limit * 0.6)));
    let after = takeLeftByDisplayWidth(afterCursor, Math.max(0, limit - stringDisplayWidth(before)));
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

function renderTraceState(active: boolean, currentPhase: Phase, target: Phase, enabled: boolean): TraceChipProps["state"] {
    if (!enabled) {
        return active && currentPhase === target ? "active" : "idle";
    }
    if (active && currentPhase === target) {
        return "active";
    }
    return "done";
}

function Badge({ color = "gray", dim = false, label }: BadgeProps): React.ReactElement {
    return (
        <Text bold={!dim} color={c(color)} dimColor={dim}>
            [{label}]
        </Text>
    );
}

function TraceChip({ color, count, label, state }: TraceChipProps): React.ReactElement {
    const suffix = count && count > 0 ? `×${count}` : "";
    const chipLabel = `${label}${suffix}`;
    if (state === "idle") {
        return <Badge color={THEME.muted} dim label={chipLabel} />;
    }
    if (state === "error") {
        return <Badge color={THEME.error} label={chipLabel} />;
    }
    if (state === "active") {
        return <Badge color={color} label={chipLabel} />;
    }
    return <Badge color={color} dim label={chipLabel} />;
}

function DetailSection({ color = "gray", title, children }: DetailSectionProps): React.ReactElement {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Text color={c(color)} bold>
                ◇ {title}
            </Text>
            <Box marginLeft={2} flexDirection="column">
                {children}
            </Box>
        </Box>
    );
}

function BlackboardDetails({
    blackboard,
    turn,
}: {
    blackboard: BlackboardMeta | null;
    turn: BlackboardTurn | null;
}): React.ReactElement {
    if (!blackboard && !turn) {
        return (
            <DetailSection color={THEME.violet} title="Blackboard">
                <Text dimColor>No structured blackboard trace.</Text>
            </DetailSection>
        );
    }

    const latestSteps = turn?.steps.slice(-3) ?? [];
    const latestMessages = (turn?.messages.filter(isReadableBlackboardMessage) ?? []).slice(-3);

    return (
        <DetailSection color={THEME.violet} title="Blackboard">
            {blackboard ? (
                <Text>
                    mode {blackboard.mode}
                    {blackboard.status ? ` · status ${blackboard.status}` : ""}
                    {blackboard.messages ? ` · messages ${blackboard.messages}` : ""}
                    {formatDuration(blackboard.elapsedMs) ? ` · elapsed ${formatDuration(blackboard.elapsedMs)}` : ""}
                </Text>
            ) : null}
            {blackboard?.reason ? <Text dimColor>reason {truncate(blackboard.reason, 120)}</Text> : null}
            {blackboard?.turnId ? <Text dimColor>turn {blackboard.turnId}</Text> : null}
            {latestSteps.length > 0 ? (
                <>
                    <Text color={THEME.violet}>steps</Text>
                    {latestSteps.map((step) => (
                        <Box key={step.id} flexDirection="column" marginBottom={1}>
                            <Text color={c(stepTone(step))}>
                                {stepBullet(step)} round {step.round} · {titleCase(step.workerRole)} · {readStepOutcome(step)}
                            </Text>
                            <Text dimColor>{truncate(step.outputSummary, 140)}</Text>
                            {step.blockers.length > 0 ? (
                                <Text color={THEME.gold}>blockers {truncate(step.blockers.join(" · "), 140)}</Text>
                            ) : null}
                            {step.newFacts.length > 0 ? (
                                <Text color={THEME.mint}>facts {truncate(step.newFacts.join(" · "), 140)}</Text>
                            ) : null}
                        </Box>
                    ))}
                </>
            ) : null}
            {latestMessages.length > 0 ? (
                <>
                    <Text color={THEME.violet}>discussion</Text>
                    {latestMessages.map((message) => (
                        <Text key={message.id} dimColor>
                            {speakerForMessage(turn!, message)}: {truncate(message.content.replace(/\s+/gu, " "), 140)}
                        </Text>
                    ))}
                </>
            ) : null}
            {turn && turn.decisions.length > 0 ? (
                <Text dimColor>decisions {turn.decisions.length}</Text>
            ) : null}
        </DetailSection>
    );
}

function SkillsDetails({ skills }: { skills: string[] }): React.ReactElement {
    return (
        <DetailSection color={THEME.pink} title="Skills">
            {skills.length === 0 ? <Text dimColor>No skills loaded.</Text> : null}
            {skills.map((skill) => (
                <Text key={skill} dimColor>
                    • {skill}
                </Text>
            ))}
        </DetailSection>
    );
}

function ToolsDetails({ tools }: { tools: McpTrace[] }): React.ReactElement {
    return (
        <DetailSection color={THEME.cyanSoft} title="Tools">
            {tools.length === 0 ? <Text dimColor>No tool calls recorded.</Text> : null}
            {tools.map((tool, index) => (
                <Box key={`${tool.server}-${tool.tool}-${index}`} flexDirection="column" marginBottom={1}>
                    <Text color={tool.ok ? THEME.mint : THEME.error}>
                        {tool.ok ? "✓" : "✗"} {tool.server}.{tool.tool}
                    </Text>
                    {tool.resultText ? <Text dimColor>{truncate(tool.resultText.replace(/\s+/gu, " "), 140)}</Text> : null}
                </Box>
            ))}
        </DetailSection>
    );
}

function MetadataDetails({ metadata }: { metadata: GatewayReply["metadata"] | null }): React.ReactElement {
    const lines = metadataLines(metadata);
    return (
        <DetailSection color={THEME.gold} title="Metadata">
            {lines.length === 0 ? <Text dimColor>No metadata.</Text> : null}
            {lines.map((line) => (
                <Text key={line} dimColor>
                    {line}
                </Text>
            ))}
        </DetailSection>
    );
}

function TurnCard({ turn, expanded, isActive, isLatest, minimalMode, phase }: TurnCardProps): React.ReactElement {
    const phaseDef = PHASE_DEF[phase];
    const phaseIcon = useAnim(isActive, phaseDef.frames);
    const skills = readSkillNames(turn);
    const tools = turn.mcpCalls;
    const route = turn.blackboard?.mode ?? "direct";
    const statusLabel = turn.error ? "ERROR" : isActive ? phaseDef.label : "DONE";
    const statusColor: ToneColor = turn.error ? THEME.error : isActive ? phaseDef.color : THEME.mint;
    const open = hasAnyDetails(expanded);

    return (
        <Box
            backgroundColor={THEME.panel}
            borderStyle="round"
            borderColor={c(isActive ? phaseDef.color : turn.error ? THEME.error : THEME.border)}
            flexDirection="column"
            paddingX={1}
        >
            <Box justifyContent="space-between">
                <Box>
                    <Text color={THEME.cyanSoft} bold>
                        You
                    </Text>
                    <Text dimColor> {fmtTime(turn.startedAt)}</Text>
                </Box>
                <Badge color={statusColor} label={statusLabel} />
            </Box>
            <Text>{turn.userMessage}</Text>

            <Box marginTop={1} flexWrap="wrap">
                <TraceChip
                    color={THEME.cyan}
                    label={isActive && phase === "thinking" ? `${phaseIcon} think` : "think"}
                    state={renderTraceState(isActive, phase, "thinking", true)}
                />
                <Box marginLeft={1}>
                    <TraceChip
                        color={THEME.violet}
                        label="board"
                        state={renderTraceState(isActive, phase, "blackboard", turn.blackboard?.mode === "blackboard")}
                    />
                </Box>
                <Box marginLeft={1}>
                    <TraceChip
                        color={THEME.pink}
                        count={skills.length}
                        label="skill"
                        state={renderTraceState(isActive, phase, "skill", skills.length > 0)}
                    />
                </Box>
                <Box marginLeft={1}>
                    <TraceChip
                        color={THEME.cyanSoft}
                        count={readToolCount(turn)}
                        label="tool"
                        state={renderTraceState(isActive, phase, "mcp", readToolCount(turn) > 0)}
                    />
                </Box>
                <Box marginLeft={1}>
                    <TraceChip
                        color={THEME.silver}
                        label={isActive && phase === "streaming" ? `${phaseIcon} write` : "write"}
                        state={renderTraceState(isActive, phase, "streaming", turn.assistantText.length > 0 || Boolean(turn.completedAt))}
                    />
                </Box>
                <Box marginLeft={1}>
                    <Badge color={THEME.muted} dim label={`route:${route}`} />
                </Box>
                {isLatest && !minimalMode ? (
                    <Box marginLeft={1}>
                        <Badge color={THEME.muted} dim label={open ? "details:open" : "details:closed"} />
                    </Box>
                ) : null}
            </Box>

            <Box marginTop={1}>
                <Text color={THEME.silver} bold>
                    Flyflor
                </Text>
                <Text dimColor> {fmtTime(turn.completedAt ?? turn.startedAt)}</Text>
            </Box>
            <Text>
                {turn.assistantText || (isActive ? `${phaseDef.label.toLowerCase()}…` : " ")}
            </Text>

            {turn.error ? (
                <Box marginTop={1}>
                    <Text color={THEME.error}>error {turn.error}</Text>
                </Box>
            ) : null}

            {expanded.blackboard ? <BlackboardDetails blackboard={turn.blackboard} turn={turn.blackboardTurn} /> : null}
            {expanded.skills ? <SkillsDetails skills={skills} /> : null}
            {expanded.mcp ? <ToolsDetails tools={tools} /> : null}
            {expanded.metadata ? <MetadataDetails metadata={turn.metadata} /> : null}
        </Box>
    );
}

function ChatHeader({
    agentName,
    compactMode,
    minimalMode,
    processing,
    scrollOfs,
    phase,
}: {
    agentName: string;
    compactMode: boolean;
    minimalMode: boolean;
    processing: boolean;
    scrollOfs: number;
    phase: Phase;
}): React.ReactElement {
    const label = processing ? PHASE_DEF[phase].label : PHASE_DEF.idle.label;
    const color = processing ? PHASE_DEF[phase].color : THEME.muted;
    const shortcutText = minimalMode ? "" : compactMode ? "Enter · Tab · ^C" : "Enter send · Tab details · ^C confirm";

    return (
        <Box backgroundColor={THEME.panelAlt} borderStyle="round" borderColor={THEME.cyanSoft} paddingX={1}>
            <Text color={THEME.violet} bold>
                ◈
            </Text>
            <Text color={THEME.silver} bold>
                {" "}FLYFLOR
            </Text>
            <Text color={THEME.violet} bold>
                {" "}
                Chat
            </Text>
            {!compactMode ? (
                <Text dimColor>
                    {" "}agent {agentName}
                </Text>
            ) : null}
            <Box flexGrow={1} />
            {shortcutText.length > 0 ? <Text dimColor>{shortcutText}</Text> : null}
            <Box marginLeft={1}>
                <Badge color={color} label={label} />
            </Box>
            {scrollOfs > 0 ? (
                <Box marginLeft={1}>
                    <Badge color={THEME.gold} label={`HISTORY+${scrollOfs}`} />
                </Box>
            ) : null}
        </Box>
    );
}

function ChatStatusStrip({
    currentTurn,
    error,
    phase,
    processing,
    scrollOfs,
    showInspector,
}: {
    currentTurn: Turn | null;
    error: string | null;
    phase: Phase;
    processing: boolean;
    scrollOfs: number;
    showInspector: boolean;
}): React.ReactElement {
    const skills = currentTurn ? readSkillNames(currentTurn).length : 0;
    const tools = currentTurn ? readToolCount(currentTurn) : 0;
    const boardMode = currentTurn?.blackboard?.mode ?? "direct";

    return (
        <Box backgroundColor={THEME.panel} borderStyle="single" borderColor={THEME.border} paddingX={1} flexWrap="wrap">
            <Badge color={processing ? PHASE_DEF[phase].color : THEME.muted} label={`phase:${processing ? phase : "idle"}`} />
            <Box marginLeft={1}>
                <Badge color={boardMode === "blackboard" ? THEME.violet : THEME.muted} label={`board:${boardMode}`} />
            </Box>
            <Box marginLeft={1}>
                <Badge color={skills > 0 ? THEME.pink : THEME.muted} label={`skills:${skills}`} />
            </Box>
            <Box marginLeft={1}>
                <Badge color={tools > 0 ? THEME.cyanSoft : THEME.muted} label={`tools:${tools}`} />
            </Box>
            <Box marginLeft={1}>
                <Badge color={scrollOfs > 0 ? THEME.gold : THEME.muted} label={`scroll:${scrollOfs > 0 ? "scrolled" : "live"}`} />
            </Box>
            {!showInspector && currentTurn?.blackboard?.status ? (
                <Box marginLeft={1}>
                    <Badge color={THEME.violet} label={`status:${currentTurn.blackboard.status}`} />
                </Box>
            ) : null}
            {error ? (
                <Box marginLeft={1}>
                    <Badge color={THEME.error} label={truncate(`error:${error}`, 44)} />
                </Box>
            ) : null}
        </Box>
    );
}

function EmptyState(): React.ReactElement {
    return (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
            <Box flexDirection="column" alignItems="center">
                <Text color={THEME.silver} bold>
                    Start an agent session
                </Text>
                <Text color={THEME.muted}>Ask a question, request a task, or inspect runtime details with Tab.</Text>
                <Text color={THEME.muted}>Press Enter to send • Ctrl+C to clear / confirm exit</Text>
            </Box>
        </Box>
    );
}

function RightInspector({
    currentTurn,
    error,
    phase,
    processing,
}: {
    currentTurn: Turn | null;
    error: string | null;
    phase: Phase;
    processing: boolean;
}): React.ReactElement {
    const skills = currentTurn ? readSkillNames(currentTurn).slice(-5) : [];
    const tools = currentTurn?.mcpCalls.slice(-4) ?? [];
    const blackboard = currentTurn?.blackboard;
    const latestActivityAt = currentTurn?.completedAt ?? currentTurn?.startedAt;

    return (
        <Box width={38} flexDirection="column">
            <Box backgroundColor={THEME.panelAlt} borderStyle="round" borderColor={THEME.violet} paddingX={1} flexDirection="column">
                <Text color={THEME.violet} bold>
                    ◆ Current turn
                </Text>
                <Text>
                    phase {processing ? phase : "idle"}
                    {latestActivityAt ? ` · ${formatRelativeTime(latestActivityAt)}` : ""}
                </Text>
                <Text dimColor>route {blackboard?.mode ?? "direct"}</Text>
                {blackboard?.status ? <Text dimColor>blackboard {blackboard.status}</Text> : null}
                {blackboard?.reason ? <Text dimColor>{truncate(blackboard.reason, 90)}</Text> : null}
                {error ? <Text color={THEME.error}>last error {truncate(error, 90)}</Text> : null}
            </Box>

            <Box backgroundColor={THEME.panel} borderStyle="single" borderColor={THEME.border} paddingX={1} flexDirection="column" marginTop={1}>
                <Text color={THEME.pink} bold>
                    ◇ Skills
                </Text>
                {skills.length === 0 ? <Text dimColor>No skills in latest turn.</Text> : null}
                {skills.map((skill) => (
                    <Text key={skill} dimColor>
                        • {truncate(skill, 32)}
                    </Text>
                ))}
            </Box>

            <Box backgroundColor={THEME.panel} borderStyle="single" borderColor={THEME.border} paddingX={1} flexDirection="column" marginTop={1}>
                <Text color={THEME.cyanSoft} bold>
                    ◇ Tools
                </Text>
                {tools.length === 0 ? <Text dimColor>No tool calls in latest turn.</Text> : null}
                {tools.map((tool, index) => (
                    <Text key={`${tool.server}-${tool.tool}-${index}`} dimColor>
                        {tool.ok ? "✓" : "✗"} {truncate(`${tool.server}.${tool.tool}`, 32)}
                    </Text>
                ))}
            </Box>

            <Box backgroundColor={THEME.panel} borderStyle="single" borderColor={THEME.border} paddingX={1} flexDirection="column" marginTop={1}>
                <Text color={THEME.cyan} bold>
                    ◇ Keys
                </Text>
                <Text dimColor>Tab all details</Text>
                <Text dimColor>Ctrl+B board</Text>
                <Text dimColor>Ctrl+T tools</Text>
                <Text dimColor>Ctrl+S skills</Text>
                <Text dimColor>Up/Down history</Text>
                <Text dimColor>Ctrl+C clear / confirm exit</Text>
            </Box>
        </Box>
    );
}

function ComposerBar({
    compactMode,
    input,
    cursor,
    minimalMode,
    notice,
    phase,
    processing,
    termCols,
}: {
    compactMode: boolean;
    cursor: number;
    input: string;
    minimalMode: boolean;
    notice: NoticeState | null;
    phase: Phase;
    processing: boolean;
    termCols: number;
}): React.ReactElement {
    const phaseDef = PHASE_DEF[phase];
    const icon = useAnim(processing, phaseDef.frames);
    const limit = Math.max(8, termCols - (minimalMode ? 18 : compactMode ? 28 : 38));
    const window = buildInputWindow(input, cursor, limit);
    const hasContent = input.length > 0;

    return (
        <Box
            backgroundColor={THEME.panelAlt}
            borderStyle="round"
            borderColor={processing ? c(phaseDef.color) : THEME.cyanSoft}
            paddingX={1}
            flexDirection="column"
        >
            <Box>
                <Text color={THEME.cyanSoft} bold>
                    ›
                </Text>
                <Box marginLeft={1} flexGrow={1}>
                    {!hasContent ? (
                        <Text color={THEME.muted}>{processing ? "Agent is working…" : "Type a message…"}</Text>
                    ) : (
                        <Text>
                            {window.clippedLeft ? "…" : ""}
                            {window.before}
                            {!processing ? <Text color={THEME.cyanSoft}>▎</Text> : null}
                            {window.after}
                            {window.clippedRight ? "…" : ""}
                        </Text>
                    )}
                </Box>
                <Badge color={processing ? phaseDef.color : THEME.muted} label={processing ? phaseDef.label : "READY"} />
                {processing ? (
                    <Box marginLeft={1}>
                        <Text color={c(phaseDef.color)}>{icon || phaseDef.done}</Text>
                    </Box>
                ) : null}
            </Box>
            {!minimalMode ? (
                <Text color={notice?.color ?? THEME.muted}>
                    {notice?.text ??
                        (compactMode
                            ? "Enter send · Ctrl+U clear line · Ctrl+W delete word · Ctrl+C confirm exit"
                            : "Enter send · Left/Right move cursor · Ctrl+U clear line · Ctrl+W delete word · Ctrl+C confirm exit")}
                </Text>
            ) : null}
        </Box>
    );
}

function RenderSegments({ segments }: { segments: Array<{ bold?: boolean; color?: ToneColor; dim?: boolean; text: string }> }): React.ReactElement {
    return (
        <Text>
            {segments.map((segment, index) => (
                <Text key={`${index}-${segment.text}`} bold={segment.bold} color={segment.color} dimColor={segment.dim}>
                    {segment.text}
                </Text>
            ))}
        </Text>
    );
}

function framedRowText(content: string, width: number, scrollbarChar?: string): string {
    const contentWidth = Math.max(1, width - (scrollbarChar ? 3 : 2));
    return `│${padDisplayText(truncateDisplayText(content, contentWidth), contentWidth)}${scrollbarChar ?? ""}│`;
}

function FrameLine({
    borderColor,
    content,
    contentBold,
    contentColor,
    contentDim,
    scrollbarChar,
    scrollbarColor,
}: {
    borderColor: ToneColor;
    content: string;
    contentBold?: boolean;
    contentColor: ToneColor;
    contentDim?: boolean;
    scrollbarChar?: string;
    scrollbarColor?: ToneColor;
}): React.ReactElement {
    return (
        <RenderSegments
            segments={[
                { color: borderColor, text: "│" },
                { bold: contentBold, color: contentColor, dim: contentDim, text: content },
                ...(scrollbarChar ? [{ color: scrollbarColor ?? borderColor, text: scrollbarChar }] : []),
                { color: borderColor, text: "│" },
            ]}
        />
    );
}

function HeaderPanel({
    agentName,
    phase,
    processing,
    scrollOffset,
    width,
}: {
    agentName: string;
    phase: Phase;
    processing: boolean;
    scrollOffset: number;
    width: number;
}): React.ReactElement {
    const left = `◈ FEIHUA · chat · agent: ${agentName}`;
    const rightParts = [
        width >= BREAKPOINT_COMPACT ? "Enter send · ↑↓ scroll · Tab details · ^T tools · ^C quit" : "Enter · ↑↓ · ^C",
        `[${processing ? PHASE_DEF[phase].label : "IDLE"}]`,
    ];
    if (scrollOffset > 0) {
        rightParts.push(`[SCROLLED+${scrollOffset}]`);
    }
    const raw = [left, rightParts.filter(Boolean).join(" ")].filter(Boolean).join("   ");
    return (
        <Box flexDirection="column">
            <Text color={THEME.cyanSoft}>{`╭${"─".repeat(Math.max(0, width - 2))}╮`}</Text>
            <FrameLine
                borderColor={THEME.cyanSoft}
                content={padDisplayText(truncateDisplayText(raw, width - 2), width - 2)}
                contentBold
                contentColor={THEME.silver}
            />
            <Text color={THEME.cyanSoft}>{`╰${"─".repeat(Math.max(0, width - 2))}╯`}</Text>
        </Box>
    );
}

function StatusPanel({
    currentTurn,
    error,
    phase,
    processing,
    scrollOffset,
    width,
}: {
    currentTurn: Turn | null;
    error: string | null;
    phase: Phase;
    processing: boolean;
    scrollOffset: number;
    width: number;
}): React.ReactElement {
    const skills = currentTurn ? readSkillNames(currentTurn).length : 0;
    const tools = currentTurn ? readToolCount(currentTurn) : 0;
    const boardMode = currentTurn?.blackboard?.mode ?? "direct";
    const text = [
        `[phase:${processing ? phase : "idle"}]`,
        `[board:${boardMode}]`,
        `[skills:${skills}]`,
        `[tools:${tools}]`,
        `[session:${scrollOffset > 0 ? "scrolled" : "live"}]`,
        error ? `[error:${truncate(error, 22)}]` : "",
    ]
        .filter(Boolean)
        .join(" ");
    return (
        <Box flexDirection="column">
            <Text color={THEME.border}>{`┌${"─".repeat(Math.max(0, width - 2))}┐`}</Text>
            <FrameLine
                borderColor={THEME.border}
                content={padDisplayText(truncateDisplayText(text, width - 2), width - 2)}
                contentBold
                contentColor={THEME.silver}
            />
            <Text color={THEME.border}>{`└${"─".repeat(Math.max(0, width - 2))}┘`}</Text>
        </Box>
    );
}

function ScrollbarChars(total: number, viewport: number, start: number): string[] {
    if (viewport <= 0) {
        return [];
    }
    if (total <= viewport) {
        return Array.from({ length: viewport }, () => " ");
    }
    const thumbSize = Math.max(1, Math.round((viewport * viewport) / total));
    const maxThumbStart = Math.max(0, viewport - thumbSize);
    const thumbStart = Math.round((start * maxThumbStart) / Math.max(1, total - viewport));
    return Array.from({ length: viewport }, (_, index) => (index >= thumbStart && index < thumbStart + thumbSize ? "█" : "┆"));
}

function ConversationViewport({
    height,
    lines,
    scrollOffset,
    width,
}: {
    height: number;
    lines: ViewLine[];
    scrollOffset: number;
    width: number;
}): React.ReactElement {
    const totalLines = lines.length;
    const maxOffset = Math.max(0, totalLines - height);
    const safeOffset = Math.min(scrollOffset, maxOffset);
    const start = Math.max(0, totalLines - height - safeOffset);
    const viewportLines = lines.slice(start, start + height);
    const scrollbar = ScrollbarChars(totalLines, height, start);
    const contentWidth = Math.max(1, width - 3);

    return (
        <Box flexDirection="column">
            <Text color={THEME.border}>{`╭${"─".repeat(Math.max(0, width - 2))}╮`}</Text>
            {Array.from({ length: height }, (_, index) => {
                const line = viewportLines[index] ?? { text: "" };
                const content = padDisplayText(truncateDisplayText(line.text, contentWidth), contentWidth);
                return (
                    <FrameLine
                        key={`viewport-${index}`}
                        borderColor={THEME.border}
                        content={content}
                        contentBold={line.bold}
                        contentColor={line.color ?? THEME.silver}
                        contentDim={line.dim}
                        scrollbarChar={scrollbar[index] ?? " "}
                        scrollbarColor={scrollbar[index] === "█" ? THEME.cyanSoft : THEME.border}
                    />
                );
            })}
            <Text color={THEME.border}>{`╰${"─".repeat(Math.max(0, width - 2))}╯`}</Text>
        </Box>
    );
}

function InspectorPanel({
    height,
    lines,
    width,
}: {
    height: number;
    lines: ViewLine[];
    width: number;
}): React.ReactElement {
    const contentWidth = Math.max(1, width - 2);
    return (
        <Box flexDirection="column">
            <Text color={THEME.violet}>{`╭${"─".repeat(Math.max(0, width - 2))}╮`}</Text>
            {Array.from({ length: height }, (_, index) => {
                const line = lines[index] ?? { text: "" };
                const content = padDisplayText(truncateDisplayText(line.text, contentWidth), contentWidth);
                return (
                    <FrameLine
                        key={`inspector-${index}`}
                        borderColor={THEME.violet}
                        content={content}
                        contentBold={line.bold}
                        contentColor={line.color ?? THEME.silver}
                        contentDim={line.dim}
                    />
                );
            })}
            <Text color={THEME.violet}>{`╰${"─".repeat(Math.max(0, width - 2))}╯`}</Text>
        </Box>
    );
}

function ComposerPanel({
    cursor,
    input,
    notice,
    phase,
    processing,
    agentName,
    width,
}: {
    cursor: number;
    input: string;
    notice: NoticeState | null;
    phase: Phase;
    processing: boolean;
    agentName: string;
    width: number;
}): React.ReactElement {
    const phaseLabel = processing ? PHASE_DEF[phase].label : "READY";
    const inputWidth = Math.max(10, width - stringDisplayWidth(`│ ›  [${phaseLabel}]│`) - 1);
    const window = buildInputWindow(input, cursor, inputWidth);
    const body = input.length === 0
        ? `Type a message to ${agentName}…`
        : `${window.clippedLeft ? "…" : ""}${window.before}${processing ? "" : "▎"}${window.after}${window.clippedRight ? "…" : ""}`;
    const hint =
        notice?.text ??
        "Enter send · Ctrl+U clear line · Ctrl+W delete word · Ctrl+C clear / confirm exit · ↑↓ PgUp PgDn scroll";

    return (
        <Box flexDirection="column">
            <Text color={THEME.cyanSoft}>{`╭${"─".repeat(Math.max(0, width - 2))}╮`}</Text>
            <FrameLine
                borderColor={THEME.cyanSoft}
                content={padDisplayText(truncateDisplayText(`› ${body} [${phaseLabel}]`, width - 2), width - 2)}
                contentBold={input.length > 0}
                contentColor={input.length === 0 ? THEME.muted : THEME.silver}
            />
            <FrameLine
                borderColor={THEME.cyanSoft}
                content={padDisplayText(truncateDisplayText(hint, width - 2), width - 2)}
                contentColor={notice?.color ?? THEME.muted}
            />
            <Text color={THEME.cyanSoft}>{`╰${"─".repeat(Math.max(0, width - 2))}╯`}</Text>
        </Box>
    );
}

export function ChatTui({
    runtime,
    blackboard,
    eventBus,
    approveMcpToolCall,
    agentName = "flyflor",
    userId = "human",
}: ChatTuiProps): React.ReactElement {
    const { exit } = useApp();
    const { cols: termCols, rows: termRows } = useTermSize();

    const showInspector = termCols >= BREAKPOINT_INSPECTOR;
    const minimalMode = termCols < BREAKPOINT_MINIMAL;
    const inspectorWidth = showInspector ? 38 : 0;
    const conversationWidth = showInspector ? Math.max(1, termCols - inspectorWidth - 1) : termCols;
    const mainViewportHeight = Math.max(1, termRows - 12);

    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [cursor, setCursor] = useState(0);
    const [processing, setProcessing] = useState(false);
    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<NoticeState | null>(null);
    const [expanded, setExpanded] = useState<Map<string, SectionMap>>(new Map());
    const [exitArmed, setExitArmed] = useState(false);
    const [scrollOfs, setScrollOfs] = useState(0);

    const inputRef = useRef("");
    const cursorRef = useRef(0);
    const currentTurnIdRef = useRef<string | null>(null);
    const currentBlackboardTurnIdRef = useRef<string | null>(null);
    const blackboardRefreshPendingRef = useRef(false);
    const processingRef = useRef(false);
    const streamedTextRef = useRef("");

    useEffect(() => {
        inputRef.current = input;
    }, [input]);

    useEffect(() => {
        cursorRef.current = cursor;
    }, [cursor]);

    const clearExitIntent = useCallback(() => {
        setExitArmed(false);
        setNotice((current) => (current?.kind === "exit" ? null : current));
    }, []);

    const refreshBlackboardTurn = useCallback(
        async (chatTurnId: string, blackboardTurnId: string): Promise<void> => {
            if (!blackboard) {
                return;
            }
            const record = await blackboard.getTurn(blackboardTurnId).catch(() => undefined);
            if (!record) {
                return;
            }
            setTurns((current) =>
                updateTurnById(current, chatTurnId, (turn) => ({
                    ...turn,
                    blackboardTurn: record,
                })),
            );
        },
        [blackboard],
    );

    const scheduleBlackboardRefresh = useCallback((): void => {
        const chatTurnId = currentTurnIdRef.current;
        const blackboardTurnId = currentBlackboardTurnIdRef.current;
        if (!chatTurnId || !blackboardTurnId || blackboardRefreshPendingRef.current) {
            return;
        }
        blackboardRefreshPendingRef.current = true;
        queueMicrotask(() => {
            blackboardRefreshPendingRef.current = false;
            void refreshBlackboardTurn(chatTurnId, blackboardTurnId);
        });
    }, [refreshBlackboardTurn]);

    useEffect(() => {
        if (!eventBus) {
            return;
        }

        const sink: EventSink = {
            publish: (event: RuntimeEvent) => {
                const currentTurnId = currentTurnIdRef.current;
                const payload = readRecord(event.payload);

                if (event.type === RuntimeEventType.BlackboardTurnStart) {
                    setPhase("blackboard");
                    const blackboardTurnId = readString(payload?.turnId);
                    if (blackboardTurnId) {
                        currentBlackboardTurnIdRef.current = blackboardTurnId;
                    }
                    setTurns((current) =>
                        updateTurnById(current, currentTurnId, (turn) => ({
                            ...turn,
                            blackboard: {
                                elapsedMs: turn.blackboard?.elapsedMs,
                                messages: turn.blackboard?.messages,
                                mode: "blackboard",
                                reason: turn.blackboard?.reason,
                                status: "running",
                                turnId: blackboardTurnId ?? turn.blackboard?.turnId,
                            },
                        })),
                    );
                    return;
                }

                if (event.type === RuntimeEventType.BlackboardTurnEnd) {
                    const blackboardTurnId = readString(payload?.turnId);
                    const status = readString(payload?.status);
                    setPhase("thinking");
                    setTurns((current) =>
                        updateTurnById(current, currentTurnId, (turn) => ({
                            ...turn,
                            blackboard: turn.blackboard
                                ? {
                                      ...turn.blackboard,
                                      status: status ?? turn.blackboard.status,
                                      turnId: blackboardTurnId ?? turn.blackboard.turnId,
                                  }
                                : {
                                      mode: "blackboard",
                                      status,
                                      turnId: blackboardTurnId,
                                  },
                        })),
                    );
                    if (currentTurnId && blackboardTurnId) {
                        void refreshBlackboardTurn(currentTurnId, blackboardTurnId);
                    }
                    return;
                }

                if (event.type === RuntimeEventType.McpToolCallExecuted) {
                    setPhase("mcp");
                    const nextTrace: McpTrace = {
                        ok: payload?.ok === true,
                        resultText: readString(payload?.resultSummary) ?? "",
                        server: readString(payload?.server) ?? "",
                        tool: readString(payload?.tool) ?? "",
                    };
                    setTurns((current) =>
                        updateTurnById(current, currentTurnId, (turn) => ({
                            ...turn,
                            mcpCalls: mergeMcpTraces(turn.mcpCalls, [nextTrace]),
                        })),
                    );
                    return;
                }

                if (event.type === RuntimeEventType.BlackboardWorkerStart) {
                    setPhase("blackboard");
                    scheduleBlackboardRefresh();
                    return;
                }

                if (event.type === RuntimeEventType.BlackboardWorkerEnd) {
                    scheduleBlackboardRefresh();
                    return;
                }

                if (event.type === RuntimeEventType.BlackboardMessageAppended) {
                    scheduleBlackboardRefresh();
                    return;
                }

                if (event.type === RuntimeEventType.SkillContextBuilt) {
                    setPhase("skill");
                    const skillNames = readStringArray(payload?.skillNames);
                    if (skillNames.length === 0) {
                        return;
                    }
                    setTurns((current) =>
                        updateTurnById(current, currentTurnId, (turn) => ({
                            ...turn,
                            skills: uniqueStrings([...turn.skills, ...skillNames]),
                        })),
                    );
                }
            },
        };

        const unsubscribe = eventBus.subscribe(sink);
        return () => unsubscribe();
    }, [eventBus, refreshBlackboardTurn, scheduleBlackboardRefresh]);

    const latestTurn = turns.at(-1) ?? null;
    const conversationLines = buildConversationLines(
        turns,
        Math.max(1, conversationWidth - 3),
        latestTurn?.id ?? null,
        expanded,
        minimalMode,
        phase,
        processing,
    );
    const maxScroll = Math.max(0, conversationLines.length - mainViewportHeight);
    const clampedScroll = Math.min(scrollOfs, maxScroll);
    const inspectorLines = buildInspectorLines(
        latestTurn,
        error,
        phase,
        processing,
        clampedScroll,
        Math.max(1, inspectorWidth - 2),
    );

    const setTurnSection = useCallback((section: Section | "all") => {
        const latest = turns.at(-1);
        if (!latest) {
            return;
        }
        setExpanded((current) => {
            const next = new Map(current);
            const previous = next.get(latest.id) ?? emptySections();
            next.set(
                latest.id,
                section === "all" ? toggleAllSections(previous) : { ...previous, [section]: !previous[section] },
            );
            return next;
        });
    }, [turns]);

    const submit = useCallback(async () => {
        const text = inputRef.current.trim();
        if (!text || processingRef.current) {
            return;
        }

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

        inputRef.current = "";
        cursorRef.current = 0;
        streamedTextRef.current = "";
        currentTurnIdRef.current = turnId;
        processingRef.current = true;

        setInput("");
        setCursor(0);
        setError(null);
        setNotice(null);
        setExitArmed(false);
        setProcessing(true);
        setPhase("thinking");
        setScrollOfs(0);
        setTurns((current) => [...current, turn]);

        const context: RuntimeContext = {
            now: startedAt,
            requestId: crypto.randomUUID(),
        };
        const message: GatewayMessage = {
            id: crypto.randomUUID(),
            receivedAt: startedAt,
            route: {
                channel: Channel.Stdio,
                chatId: "chat-tui",
                chatType: ChatType.Direct,
            },
            text,
            user: { id: userId },
        };

        try {
            const reply = await runtime.handleMessage(message, context, {
                approveMcpToolCall: approveMcpToolCall ?? (async () => true),
                onTextDelta: (chunk: string) => {
                    streamedTextRef.current += chunk;
                    setPhase("streaming");
                    setTurns((current) =>
                        updateTurnById(current, turnId, (item) => ({
                            ...item,
                            assistantText: streamedTextRef.current,
                        })),
                    );
                },
            });

            const blackboardMeta = readBlackboardMeta(reply.metadata);
            const blackboardTurnId = blackboardMeta?.turnId;
            const blackboardTurn = blackboardTurnId ? await blackboard?.getTurn(blackboardTurnId).catch(() => undefined) : undefined;

            setTurns((current) =>
                updateTurnById(current, turnId, (item) => ({
                    ...item,
                    assistantText: reply.text,
                    blackboard: blackboardMeta,
                    blackboardTurn: blackboardTurn ?? item.blackboardTurn,
                    completedAt: new Date().toISOString(),
                    mcpCalls: mergeMcpTraces(item.mcpCalls, readMcpExecutions(reply.metadata)),
                    metadata: reply.metadata ?? null,
                    skills: uniqueStrings([...item.skills, ...readMetadataSkills(reply.metadata)]),
                })),
            );
        } catch (cause) {
            const messageText = cause instanceof Error ? cause.message : String(cause);
            setError(messageText);
            setNotice({ color: THEME.error, kind: "runtime", text: "The last turn failed. Review the error block or retry." });
            setTurns((current) =>
                updateTurnById(current, turnId, (item) => ({
                    ...item,
                    assistantText: item.assistantText || `Error: ${messageText}`,
                    completedAt: new Date().toISOString(),
                    error: messageText,
                })),
            );
        } finally {
            currentTurnIdRef.current = null;
            currentBlackboardTurnIdRef.current = null;
            processingRef.current = false;
            setProcessing(false);
            setPhase("idle");
        }
    }, [approveMcpToolCall, blackboard, runtime, userId]);

    const requestExit = useCallback(() => {
        if (processing) {
            setNotice({ color: THEME.gold, kind: "exit", text: "Wait for the current turn to finish before exiting." });
            return;
        }

        if (inputRef.current.length > 0) {
            inputRef.current = "";
            cursorRef.current = 0;
            setInput("");
            setCursor(0);
            setExitArmed(true);
            setNotice({ color: THEME.gold, kind: "exit", text: "Input cleared. Press Ctrl+C again to confirm exit." });
            return;
        }

        if (!exitArmed) {
            setExitArmed(true);
            setNotice({ color: THEME.error, kind: "exit", text: "Press Ctrl+C again to exit Flyflor chat." });
            return;
        }

        exit();
    }, [exit, exitArmed, processing]);

    useInput(
        (keyInput, key) => {
            if (key.escape || (key.ctrl && keyInput === "c")) {
                requestExit();
                return;
            }

            if (key.ctrl && keyInput === "l") {
                clearExitIntent();
                setTurns([]);
                setExpanded(new Map());
                setError(null);
                setNotice(null);
                setScrollOfs(0);
                currentTurnIdRef.current = null;
                currentBlackboardTurnIdRef.current = null;
                return;
            }

            if (key.ctrl && keyInput === "b") {
                clearExitIntent();
                setTurnSection("blackboard");
                return;
            }
            if (key.ctrl && keyInput === "t") {
                clearExitIntent();
                setTurnSection("mcp");
                return;
            }
            if (key.ctrl && keyInput === "s") {
                clearExitIntent();
                setTurnSection("skills");
                return;
            }
            if (key.tab) {
                clearExitIntent();
                setTurnSection("all");
                return;
            }

            if (key.return && !processing) {
                clearExitIntent();
                void submit();
                return;
            }

            if (key.upArrow) {
                clearExitIntent();
                setScrollOfs((value) => Math.min(value + 1, maxScroll));
                return;
            }
            if (key.downArrow) {
                clearExitIntent();
                setScrollOfs((value) => Math.max(0, value - 1));
                return;
            }
            if (key.pageUp) {
                clearExitIntent();
                setScrollOfs((value) => Math.min(value + mainViewportHeight, maxScroll));
                return;
            }
            if (key.pageDown) {
                clearExitIntent();
                setScrollOfs((value) => Math.max(0, value - mainViewportHeight));
                return;
            }
            if (key.home) {
                clearExitIntent();
                setScrollOfs(maxScroll);
                return;
            }
            if (key.end) {
                clearExitIntent();
                setScrollOfs(0);
                return;
            }

            if (processing) {
                return;
            }

            if (key.backspace || key.delete) {
                clearExitIntent();
                const nextCursor = Math.max(0, cursorRef.current - 1);
                if (cursorRef.current === 0) {
                    return;
                }
                const next = inputRef.current.slice(0, nextCursor) + inputRef.current.slice(cursorRef.current);
                inputRef.current = next;
                cursorRef.current = nextCursor;
                setInput(next);
                setCursor(nextCursor);
                return;
            }

            if (key.leftArrow) {
                clearExitIntent();
                const nextCursor = Math.max(0, cursorRef.current - 1);
                cursorRef.current = nextCursor;
                setCursor(nextCursor);
                return;
            }

            if (key.rightArrow) {
                clearExitIntent();
                const nextCursor = Math.min(inputRef.current.length, cursorRef.current + 1);
                cursorRef.current = nextCursor;
                setCursor(nextCursor);
                return;
            }

            if (key.ctrl && keyInput === "u") {
                clearExitIntent();
                inputRef.current = "";
                cursorRef.current = 0;
                setInput("");
                setCursor(0);
                return;
            }

            if (key.ctrl && keyInput === "w") {
                clearExitIntent();
                const position = cursorRef.current;
                const prefix = inputRef.current.slice(0, position);
                const suffix = inputRef.current.slice(position);
                const boundary = prefix.trimEnd().lastIndexOf(" ");
                const head = boundary >= 0 ? prefix.slice(0, boundary + 1) : "";
                const next = head + suffix;
                inputRef.current = next;
                cursorRef.current = head.length;
                setInput(next);
                setCursor(head.length);
                return;
            }

            if (keyInput && keyInput.length > 0 && keyInput.charCodeAt(0) >= 32) {
                clearExitIntent();
                const position = cursorRef.current;
                const next = inputRef.current.slice(0, position) + keyInput + inputRef.current.slice(position);
                inputRef.current = next;
                cursorRef.current = position + keyInput.length;
                setInput(next);
                setCursor(cursorRef.current);
            }
        },
        { isActive: true },
    );

    return (
        <Box flexDirection="column" height={termRows} overflow="hidden">
            <HeaderPanel
                agentName={agentName}
                phase={phase}
                processing={processing}
                scrollOffset={clampedScroll}
                width={termCols}
            />

            <StatusPanel
                currentTurn={latestTurn}
                error={error}
                phase={phase}
                processing={processing}
                scrollOffset={clampedScroll}
                width={termCols}
            />

            {showInspector ? (
                <Box flexDirection="row">
                    <ConversationViewport
                        height={mainViewportHeight}
                        lines={conversationLines}
                        scrollOffset={clampedScroll}
                        width={conversationWidth}
                    />
                    <Box marginLeft={1}>
                        <InspectorPanel height={mainViewportHeight} lines={inspectorLines} width={inspectorWidth} />
                    </Box>
                </Box>
            ) : (
                <ConversationViewport
                    height={mainViewportHeight}
                    lines={conversationLines}
                    scrollOffset={clampedScroll}
                    width={conversationWidth}
                />
            )}

            <ComposerPanel
                agentName={agentName}
                cursor={cursor}
                input={input}
                notice={notice}
                phase={phase}
                processing={processing}
                width={termCols}
            />
        </Box>
    );
}

export function startChatTui(
    runtime: RuntimeModule,
    options: {
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
        blackboard?: BlackboardModule;
        eventBus?: RuntimeEventBus;
        agentName?: string;
        userId?: string;
    } = {},
): void {
    render(
        <ChatTui
            approveMcpToolCall={options.approveMcpToolCall}
            agentName={options.agentName}
            blackboard={options.blackboard}
            eventBus={options.eventBus}
            runtime={runtime}
            userId={options.userId}
        />,
        {
            exitOnCtrlC: false,
        },
    )
        .waitUntilExit()
        .catch(() => {});
}

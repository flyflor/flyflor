import { Box, createCliRenderer, RGBA, Text, TextAttributes } from "@opentui/core";
import { render } from "@opentui/solid";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { FlyFlor } from "../../../app.ts";
import {
    fetchBlackboardTurnDetail,
    fetchBlackboardTurnList,
    type BlackboardTurnDetail,
    type BlackboardTurnItem,
} from "../../cli/handlers/blackboard.handler.ts";
import { createTuiLifecycle } from "../lifecycle.ts";

const THEME = {
    bg: RGBA.fromInts(13, 19, 29),
    fg: RGBA.fromInts(235, 244, 246),
    fgMuted: RGBA.fromInts(132, 154, 169),
    cyan: RGBA.fromInts(126, 232, 218),
    green: RGBA.fromInts(123, 229, 180),
    yellow: RGBA.fromInts(255, 203, 116),
    red: RGBA.fromInts(255, 111, 127),
    selectedBg: RGBA.fromInts(30, 49, 60),
    border: RGBA.fromInts(76, 106, 126),
};

type Mode = "detail" | "list";

export async function startBlackboardBrowser(app: FlyFlor): Promise<void> {
    const renderer = await createCliRenderer({
        targetFps: 30,
        exitOnCtrlC: false,
        useMouse: false,
        externalOutputMode: "passthrough",
    });

    const [turns, setTurns] = createSignal<BlackboardTurnItem[]>([]);
    const [query, setQuery] = createSignal("");
    const [searching, setSearching] = createSignal(false);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [mode, setMode] = createSignal<Mode>("list");
    const [detail, setDetail] = createSignal<BlackboardTurnDetail | null>(null);
    const [detailOffset, setDetailOffset] = createSignal(0);
    const [loading, setLoading] = createSignal(false);
    const [err, setErr] = createSignal<string | null>(null);

    const refresh = async (): Promise<void> => {
        setLoading(true);
        try {
            setTurns(await fetchBlackboardTurnList(app, 120));
            setErr(null);
        } catch (cause) {
            setErr(describeError(cause));
            console.error(cause);
        } finally {
            setLoading(false);
        }
    };

    await refresh();

    const filteredTurns = createMemo(() => {
        const needle = query().trim().toLowerCase();
        if (!needle) return turns();
        return turns().filter((turn) =>
            [turn.id, turn.status, turn.projectConstraintId, turn.goal, turn.updatedAt].some((value) =>
                value.toLowerCase().includes(needle),
            ),
        );
    });

    createEffect(() => {
        const count = filteredTurns().length;
        if (count === 0) {
            setSelectedIndex(0);
            return;
        }
        if (selectedIndex() >= count) {
            setSelectedIndex(count - 1);
        }
    });

    const listWindow = createMemo(() => {
        const items = filteredTurns();
        const pageSize = Math.max(6, renderer.height - 8);
        const selected = selectedIndex();
        const start = clamp(selected - Math.floor(pageSize / 2), 0, Math.max(0, items.length - pageSize));
        return { items: items.slice(start, start + pageSize), start };
    });

    const detailLines = createMemo(() => (detail() ? renderDetailLines(detail()!) : []));

    const detailWindow = createMemo(() => {
        const lines = detailLines();
        const pageSize = Math.max(6, renderer.height - 7);
        const start = clamp(detailOffset(), 0, Math.max(0, lines.length - pageSize));
        if (start !== detailOffset()) {
            queueMicrotask(() => setDetailOffset(start));
        }
        return { lines: lines.slice(start, start + pageSize), start };
    });

    void render(() => {
        const width = renderer.width;
        const height = renderer.height;
        return Box(
            { backgroundColor: THEME.bg, flexDirection: "column", height, width },
            Box(
                { border: ["bottom"], borderColor: THEME.border, flexDirection: "column", padding: 1, flexShrink: 0 },
                Text({ content: "Flyflor · Blackboard", fg: THEME.cyan, attributes: TextAttributes.BOLD }),
                Text({
                    content:
                        mode() === "list"
                            ? "↑/↓ or j/k select · Enter/o/→ open · / search · r refresh · q quit"
                            : "↑/↓ or j/k scroll · Esc/q/← back · r refresh",
                    fg: THEME.fgMuted,
                }),
                Text({
                    content: searching() ? `search: ${query()}_` : query() ? `filter: ${query()}` : "filter: none",
                    fg: searching() ? THEME.yellow : THEME.fgMuted,
                }),
                err() ? Text({ content: `Error: ${err()}`, fg: THEME.red }) : undefined,
            ),
            mode() === "list" ? renderListPane() : renderDetailPane(),
        );
    }, renderer);

    const keyHandler = (event: {
        name?: string;
        ctrl?: boolean;
        preventDefault?: () => void;
        sequence?: string;
        stopPropagation?: () => void;
    }) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        const name = event.name ?? "";
        if (event.ctrl && name === "c") {
            lifecycle.destroy();
            return;
        }
        const sequence = event.sequence ?? "";
        if (searching()) {
            handleSearchKey(name, sequence);
            return;
        }
        if (mode() === "detail") {
            handleDetailKey(name, sequence);
            return;
        }
        handleListKey(name, sequence);
    };

    renderer.keyInput.on("keypress", keyHandler);
    const lifecycle = createTuiLifecycle(renderer, {
        cleanup: () => {
            renderer.keyInput.off("keypress", keyHandler);
        },
    });
    return lifecycle.waitForDestroy();

    function renderListPane() {
        const window = listWindow();
        const total = filteredTurns().length;
        const nodes = [];
        nodes.push(
            Text({
                content: `${loading() ? "loading..." : `${total} turn(s)`}${turns().length !== total ? ` from ${turns().length}` : ""}`,
                fg: THEME.fgMuted,
            }),
        );
        if (total === 0) {
            nodes.push(Text({ content: query() ? "No matching blackboard turns." : "No blackboard turns yet.", fg: THEME.fgMuted }));
        }
        for (let local = 0; local < window.items.length; local += 1) {
            const turn = window.items[local]!;
            const index = window.start + local;
            const selected = index === selectedIndex();
            nodes.push(
                Text({
                    content: `${selected ? ">" : " "} ${shortId(turn.id)} · ${turn.status} · ${turn.stepCount} step(s) · ${turn.workerCount} worker(s) · ${turn.updatedAt}`,
                    fg: selected ? THEME.cyan : statusColor(turn.status),
                    bg: selected ? THEME.selectedBg : undefined,
                    attributes: selected ? TextAttributes.BOLD : undefined,
                    selectable: true,
                }),
            );
            nodes.push(
                Text({
                    content: `  ${turn.goal}`,
                    fg: selected ? THEME.fg : THEME.fgMuted,
                    bg: selected ? THEME.selectedBg : undefined,
                    selectable: true,
                }),
            );
        }
        return Box({ flexDirection: "column", flexGrow: 1, padding: 1 }, ...nodes);
    }

    function renderDetailPane() {
        const turn = detail();
        const nodes = [];
        if (!turn) {
            nodes.push(Text({ content: "No turn selected.", fg: THEME.fgMuted }));
        } else {
            const window = detailWindow();
            nodes.push(
                Text({
                    content: `${shortId(turn.id)} · ${turn.status} · ${turn.steps.length} step(s) · ${turn.decisions.length} decision(s) · ${turn.updatedAt}`,
                    fg: statusColor(turn.status),
                    attributes: TextAttributes.BOLD,
                    selectable: true,
                }),
            );
            nodes.push(Text({ content: `id: ${turn.id}`, fg: THEME.fgMuted, selectable: true }));
            nodes.push(Text({ content: "" }));
            for (const line of window.lines) {
                nodes.push(
                    Text({
                        content: line,
                        fg: detailLineColor(line),
                        attributes: line.startsWith("◆") ? TextAttributes.BOLD : undefined,
                        selectable: true,
                    }),
                );
            }
        }
        return Box({ flexDirection: "column", flexGrow: 1, padding: 1 }, ...nodes);
    }

    async function openSelectedTurn(): Promise<void> {
        const turn = filteredTurns()[selectedIndex()];
        if (!turn) return;
        setLoading(true);
        try {
            const next = await fetchBlackboardTurnDetail(app, turn.id);
            if (!next) {
                setErr(`Blackboard turn not found: ${turn.id}`);
                return;
            }
            setDetail(next);
            setDetailOffset(0);
            setMode("detail");
            setErr(null);
        } catch (cause) {
            setErr(describeError(cause));
            console.error(cause);
        } finally {
            setLoading(false);
        }
    }

    function handleListKey(name: string, sequence: string): void {
        if (name === "q" || name === "escape") {
            lifecycle.destroy();
            return;
        }
        if (name === "r") {
            void refresh();
            return;
        }
        if (name === "/") {
            setSearching(true);
            return;
        }
        if (isDownKey(name, sequence) || name === "j") {
            setSelectedIndex((idx) => clamp(idx + 1, 0, Math.max(0, filteredTurns().length - 1)));
            return;
        }
        if (isUpKey(name, sequence) || name === "k") {
            setSelectedIndex((idx) => clamp(idx - 1, 0, Math.max(0, filteredTurns().length - 1)));
            return;
        }
        if (name === "g") {
            setSelectedIndex(0);
            return;
        }
        if (name === "G") {
            setSelectedIndex(Math.max(0, filteredTurns().length - 1));
            return;
        }
        if (isEnterKey(name, sequence) || isRightKey(name, sequence) || name === "l" || name === "o") {
            void openSelectedTurn();
        }
    }

    function handleDetailKey(name: string, sequence: string): void {
        if (name === "q" || name === "escape" || isLeftKey(name, sequence) || name === "h") {
            setMode("list");
            return;
        }
        if (name === "r") {
            void openSelectedTurn();
            return;
        }
        if (isDownKey(name, sequence) || name === "j") {
            setDetailOffset((offset) => offset + 1);
            return;
        }
        if (isUpKey(name, sequence) || name === "k") {
            setDetailOffset((offset) => Math.max(0, offset - 1));
            return;
        }
        if (name === "pagedown" || sequence === "\u001b[6~") {
            setDetailOffset((offset) => offset + Math.max(6, renderer.height - 7));
            return;
        }
        if (name === "pageup" || sequence === "\u001b[5~") {
            setDetailOffset((offset) => Math.max(0, offset - Math.max(6, renderer.height - 7)));
            return;
        }
        if (name === "g") {
            setDetailOffset(0);
            return;
        }
        if (name === "G") {
            setDetailOffset(Math.max(0, detailLines().length - Math.max(6, renderer.height - 7)));
        }
    }

    function handleSearchKey(name: string, sequence: string): void {
        if (name === "escape") {
            setSearching(false);
            return;
        }
        if (isEnterKey(name, sequence)) {
            setSearching(false);
            return;
        }
        if (name === "backspace" || name === "delete") {
            setQuery((value) => value.slice(0, -1));
            setSelectedIndex(0);
            return;
        }
        if (name === "u" && sequence === "\u0015") {
            setQuery("");
            setSelectedIndex(0);
            return;
        }
        if (sequence.length === 1 && sequence >= " " && sequence !== "\u007f") {
            setQuery((value) => value + sequence);
            setSelectedIndex(0);
        }
    }
}

function renderDetailLines(turn: BlackboardTurnDetail): string[] {
    const lines: string[] = [];
    lines.push("◆ Goal");
    lines.push(`  ${turn.goal}`);
    lines.push("");
    lines.push("◆ Workers");
    for (const worker of turn.workers) {
        lines.push(`  ${worker.role} · ${worker.name} · ${worker.status} · ${worker.stage} · handoff=${worker.handoff}`);
        if (worker.capabilities.length > 0) {
            lines.push(`    capabilities: ${worker.capabilities.join(", ")}`);
        }
    }
    lines.push("");
    lines.push("◆ Steps");
    for (const step of turn.steps) {
        lines.push(`  r${step.round} ${step.worker} · risk=${step.risk}`);
        lines.push(`    ${step.summary}`);
        for (const fact of step.newFacts) lines.push(`    fact: ${fact}`);
        for (const blocker of step.blockers) lines.push(`    blocker: ${blocker}`);
    }
    lines.push("");
    lines.push("◆ Public Messages");
    for (const message of turn.messages.filter((item) => item.visibility === "public")) {
        const round = message.round === undefined ? "" : `r${message.round} `;
        lines.push(`  ${round}${message.role} · ${message.createdAt}`);
        lines.push(`    ${message.content}`);
    }
    lines.push("");
    lines.push("◆ Decisions");
    for (const decision of turn.decisions) {
        lines.push(`  ${decision.kind} · ${decision.reason}`);
        lines.push(`    ${decision.prompt}`);
        for (const option of decision.options) {
            lines.push(`    option: ${option.label}${option.description ? ` · ${option.description}` : ""}`);
        }
    }
    return lines;
}

function shortId(id: string): string {
    return id.length <= 12 ? id : id.slice(0, 8);
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function isEnterKey(name: string, sequence: string): boolean {
    return name === "return" || name === "enter" || name === "linefeed" || sequence === "\r" || sequence === "\n";
}

function isUpKey(name: string, sequence: string): boolean {
    return name === "up" || sequence === "\u001b[A" || sequence === "\u001bOA";
}

function isDownKey(name: string, sequence: string): boolean {
    return name === "down" || sequence === "\u001b[B" || sequence === "\u001bOB";
}

function isLeftKey(name: string, sequence: string): boolean {
    return name === "left" || sequence === "\u001b[D" || sequence === "\u001bOD";
}

function isRightKey(name: string, sequence: string): boolean {
    return name === "right" || sequence === "\u001b[C" || sequence === "\u001bOC";
}

function describeError(cause: unknown): string {
    if (cause instanceof Error) {
        return cause.name && cause.name !== "Error" ? `${cause.name}: ${cause.message}` : cause.message;
    }
    return String(cause);
}

function statusColor(status: string): RGBA {
    if (status === "converged") return THEME.green;
    if (status === "failed") return THEME.red;
    if (status === "needs-user") return THEME.yellow;
    return THEME.fg;
}

function detailLineColor(line: string): RGBA {
    if (line.startsWith("◆")) return THEME.cyan;
    if (line.includes("blocker:")) return THEME.yellow;
    if (line.includes("fact:")) return THEME.green;
    if (line.includes("option:")) return THEME.yellow;
    return line.startsWith("  ") ? THEME.fg : THEME.fgMuted;
}

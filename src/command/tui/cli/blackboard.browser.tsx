import {
    BoxRenderable,
    CliRenderEvents,
    createCliRenderer,
    RGBA,
    TextAttributes,
    TextRenderable,
} from "@opentui/core";
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

export function filterBlackboardTurns(turns: BlackboardTurnItem[], query: string): BlackboardTurnItem[] {
    // Literal UI search only. This does not drive runtime routing, memory
    // actions, or model decisions, so it stays outside the zero semantic-match redline.
    const needle = query.trim().toLowerCase();
    if (!needle) return turns;
    return turns.filter((turn) =>
        [turn.id, turn.status, turn.projectConstraintId, turn.goal, turn.updatedAt].some((value) =>
            value.toLowerCase().includes(needle),
        ),
    );
}

export function listWindow<TValue>(
    items: TValue[],
    selectedIndex: number,
    pageSize: number,
): { items: TValue[]; start: number } {
    const start = clamp(selectedIndex - Math.floor(pageSize / 2), 0, Math.max(0, items.length - pageSize));
    return { items: items.slice(start, start + pageSize), start };
}

export async function startBlackboardBrowser(app: FlyFlor): Promise<void> {
    const renderer = await createCliRenderer({
        targetFps: 30,
        exitOnCtrlC: false,
        screenMode: "alternate-screen",
        useMouse: false,
        externalOutputMode: "passthrough",
    });

    let turns: BlackboardTurnItem[] = [];
    let query = "";
    let searching = false;
    let selectedIndex = 0;
    let mode: Mode = "list";
    let detail: BlackboardTurnDetail | null = null;
    let detailOffset = 0;
    let loading = false;
    let err: string | null = null;

    const root = renderer.root;
    const mainBox = new BoxRenderable(renderer, {
        backgroundColor: THEME.bg,
        flexDirection: "column",
        height: renderer.height,
        width: renderer.width,
    });
    const headerBox = new BoxRenderable(renderer, {
        border: ["bottom"],
        borderColor: THEME.border,
        flexDirection: "column",
        flexShrink: 0,
        padding: 1,
    });
    const headerTitle = new TextRenderable(renderer, {
        content: "Flyflor · Blackboard",
        fg: THEME.cyan,
        attributes: TextAttributes.BOLD,
    });
    const headerHelp = new TextRenderable(renderer, { content: "", fg: THEME.fgMuted, selectable: false });
    const headerFilter = new TextRenderable(renderer, { content: "", fg: THEME.fgMuted, selectable: true });
    const errorText = new TextRenderable(renderer, { content: "", fg: THEME.red, selectable: true });
    errorText.visible = false;
    headerBox.add(headerTitle);
    headerBox.add(headerHelp);
    headerBox.add(headerFilter);
    headerBox.add(errorText);
    mainBox.add(headerBox);
    const bodyBox = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, padding: 1 });
    mainBox.add(bodyBox);
    root.add(mainBox);

    const lineRenderables: TextRenderable[] = [];

    const refresh = async (): Promise<void> => {
        loading = true;
        syncUi();
        try {
            turns = await fetchBlackboardTurnList(app, 120);
            selectedIndex = clamp(selectedIndex, 0, Math.max(0, filterBlackboardTurns(turns, query).length - 1));
            err = null;
        } catch (cause) {
            err = describeError(cause);
            console.error(cause);
        } finally {
            loading = false;
            syncUi();
        }
    };

    await refresh();

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
        const sequence = event.sequence ?? "";
        if (event.ctrl && name === "c") {
            lifecycle.destroy();
            return;
        }
        if (searching) {
            handleSearchKey(name, sequence);
            return;
        }
        if (mode === "detail") {
            handleDetailKey(name, sequence);
            return;
        }
        handleListKey(name, sequence);
    };

    function syncUi(): void {
        headerHelp.content =
            mode === "list"
                ? "↑/↓ or j/k select · Enter/o/→ open · / search · r refresh · q quit"
                : "↑/↓ or j/k scroll · Esc/q/← back · r refresh";
        headerFilter.content = searching ? `search: ${query}_` : query ? `filter: ${query}` : "filter: none";
        headerFilter.fg = searching ? THEME.yellow : THEME.fgMuted;
        errorText.content = err ? `Error: ${err}` : "";
        errorText.visible = Boolean(err);
        const lines = mode === "list" ? renderListLines() : renderDetailPaneLines();
        while (lineRenderables.length > lines.length) {
            const stale = lineRenderables.pop()!;
            bodyBox.remove(stale.id);
        }
        for (let index = lineRenderables.length; index < lines.length; index += 1) {
            const line = lines[index]!;
            const renderable = new TextRenderable(renderer, {
                content: line.text,
                fg: line.color,
                bg: line.bg,
                attributes: line.bold ? TextAttributes.BOLD : TextAttributes.NONE,
                selectable: true,
                width: "100%",
                wrapMode: "word",
            });
            lineRenderables.push(renderable);
            bodyBox.add(renderable);
        }
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            const renderable = lineRenderables[index]!;
            renderable.content = line.text;
            renderable.fg = line.color;
            renderable.bg = line.bg;
            renderable.attributes = line.bold ? TextAttributes.BOLD : TextAttributes.NONE;
        }
        renderer.requestRender();
    }

    function renderListLines(): Array<{ text: string; color: RGBA; bg?: RGBA; bold?: boolean }> {
        const filtered = filterBlackboardTurns(turns, query);
        const total = filtered.length;
        const window = listWindow(filtered, selectedIndex, Math.max(6, renderer.height - 8));
        const lines: Array<{ text: string; color: RGBA; bg?: RGBA; bold?: boolean }> = [
            { text: loading ? "loading..." : `${total} turn(s)${turns.length !== total ? ` from ${turns.length}` : ""}`, color: THEME.fgMuted },
        ];
        if (total === 0) {
            lines.push({ text: query ? "No matching blackboard turns." : "No blackboard turns yet.", color: THEME.fgMuted });
            return lines;
        }
        for (let local = 0; local < window.items.length; local += 1) {
            const turn = window.items[local]!;
            const index = window.start + local;
            const selected = index === selectedIndex;
            lines.push({
                text: `${selected ? ">" : " "} ${shortId(turn.id)} · ${turn.status} · ${turn.stepCount} step(s) · ${turn.workerCount} worker(s) · ${turn.updatedAt}`,
                color: selected ? THEME.cyan : statusColor(turn.status),
                bg: selected ? THEME.selectedBg : undefined,
                bold: selected,
            });
            lines.push({
                text: `  ${turn.goal}`,
                color: selected ? THEME.fg : THEME.fgMuted,
                bg: selected ? THEME.selectedBg : undefined,
            });
        }
        return lines;
    }

    function renderDetailPaneLines(): Array<{ text: string; color: RGBA; bg?: RGBA; bold?: boolean }> {
        if (!detail) {
            return [{ text: "No turn selected.", color: THEME.fgMuted }];
        }
        const lines = renderDetailLines(detail);
        const pageSize = Math.max(6, renderer.height - 7);
        const start = clamp(detailOffset, 0, Math.max(0, lines.length - pageSize));
        detailOffset = start;
        return [
            {
                text: `${shortId(detail.id)} · ${detail.status} · ${detail.steps.length} step(s) · ${detail.decisions.length} decision(s) · ${detail.updatedAt}`,
                color: statusColor(detail.status),
                bold: true,
            },
            { text: `id: ${detail.id}`, color: THEME.fgMuted },
            { text: "", color: THEME.fg },
            ...lines.slice(start, start + pageSize).map((line) => ({
                text: line,
                color: detailLineColor(line),
                bold: line.startsWith("◆"),
            })),
        ];
    }

    async function openSelectedTurn(): Promise<void> {
        const turn = filterBlackboardTurns(turns, query)[selectedIndex];
        if (!turn) return;
        loading = true;
        syncUi();
        try {
            const next = await fetchBlackboardTurnDetail(app, turn.id);
            if (!next) {
                err = `Blackboard turn not found: ${turn.id}`;
                return;
            }
            detail = next;
            detailOffset = 0;
            mode = "detail";
            err = null;
        } catch (cause) {
            err = describeError(cause);
            console.error(cause);
        } finally {
            loading = false;
            syncUi();
        }
    }

    function handleListKey(name: string, sequence: string): void {
        const filtered = filterBlackboardTurns(turns, query);
        if (name === "q" || name === "escape") {
            lifecycle.destroy();
            return;
        }
        if (name === "r") {
            void refresh();
            return;
        }
        if (name === "/") {
            searching = true;
            syncUi();
            return;
        }
        if (isDownKey(name, sequence) || name === "j") {
            selectedIndex = clamp(selectedIndex + 1, 0, Math.max(0, filtered.length - 1));
            syncUi();
            return;
        }
        if (isUpKey(name, sequence) || name === "k") {
            selectedIndex = clamp(selectedIndex - 1, 0, Math.max(0, filtered.length - 1));
            syncUi();
            return;
        }
        if (name === "g") {
            selectedIndex = 0;
            syncUi();
            return;
        }
        if (name === "G") {
            selectedIndex = Math.max(0, filtered.length - 1);
            syncUi();
            return;
        }
        if (isEnterKey(name, sequence) || isRightKey(name, sequence) || name === "l" || name === "o") {
            void openSelectedTurn();
        }
    }

    function handleDetailKey(name: string, sequence: string): void {
        if (name === "q" || name === "escape" || isLeftKey(name, sequence) || name === "h") {
            mode = "list";
            syncUi();
            return;
        }
        if (name === "r") {
            void openSelectedTurn();
            return;
        }
        if (isDownKey(name, sequence) || name === "j") {
            detailOffset += 1;
            syncUi();
            return;
        }
        if (isUpKey(name, sequence) || name === "k") {
            detailOffset = Math.max(0, detailOffset - 1);
            syncUi();
            return;
        }
        if (name === "pagedown" || sequence === "\u001b[6~") {
            detailOffset += Math.max(6, renderer.height - 7);
            syncUi();
            return;
        }
        if (name === "pageup" || sequence === "\u001b[5~") {
            detailOffset = Math.max(0, detailOffset - Math.max(6, renderer.height - 7));
            syncUi();
            return;
        }
        if (name === "g") {
            detailOffset = 0;
            syncUi();
            return;
        }
        if (name === "G") {
            detailOffset = Math.max(0, renderDetailLines(detail!).length - Math.max(6, renderer.height - 7));
            syncUi();
        }
    }

    function handleSearchKey(name: string, sequence: string): void {
        if (name === "escape") {
            searching = false;
            syncUi();
            return;
        }
        if (isEnterKey(name, sequence)) {
            searching = false;
            syncUi();
            return;
        }
        if (name === "backspace" || name === "delete") {
            query = query.slice(0, -1);
            selectedIndex = 0;
            syncUi();
            return;
        }
        if (name === "u" && sequence === "\u0015") {
            query = "";
            selectedIndex = 0;
            syncUi();
            return;
        }
        if (sequence.length === 1 && sequence >= " " && sequence !== "\u007f") {
            query += sequence;
            selectedIndex = 0;
            syncUi();
        }
    }

    const resizeHandler = () => {
        mainBox.width = renderer.width;
        mainBox.height = renderer.height;
        syncUi();
    };
    renderer.on(CliRenderEvents.RESIZE, resizeHandler);
    renderer.keyInput.on("keypress", keyHandler);
    const lifecycle = createTuiLifecycle(renderer, {
        cleanup: () => {
            renderer.keyInput.off("keypress", keyHandler);
            renderer.off(CliRenderEvents.RESIZE, resizeHandler);
            root.remove(mainBox.id);
        },
    });
    syncUi();
    return lifecycle.waitForDestroy();
}

export function renderDetailLines(turn: BlackboardTurnDetail): string[] {
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

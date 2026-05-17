/**
 * Flyflor Dashboard TUI — command-rendered OpenTUI dashboard.
 *
 * Keep this path independent from framework render bridges: compiled binaries have
 * different package conditions than dev mode, and command renderables keep
 * the dashboard lifecycle predictable across both.
 */

import {
    BoxRenderable,
    CliRenderEvents,
    createCliRenderer,
    RGBA,
    ScrollBoxRenderable,
    TextAttributes,
    TextRenderable,
} from "@opentui/core";
import { BlackboardModule, MemoryModule, type FlyFlor } from "../../app.ts";
import { ConfigComponent } from "../../config/index.ts";
import {
    describeWorkingMemoryHealth,
    describeWorkingMemoryRecoveryFiles,
    resolveGatewaySnapshot,
} from "../../command/cli/status.ts";
import type { GatewayStatusSnapshot } from "../../agent/gateway/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/index.ts";
import type { FlyflorConfig } from "../../config/index.ts";
import { createTuiLifecycle } from "./lifecycle.ts";
import { useDetachedScrollBars } from "./scrollbar.composition.ts";
import { pinRendererAlternateScreen, withPinnedAlternateScreen } from "./screen.composition.ts";

const THEME = {
    bg: RGBA.fromInts(13, 19, 29),
    fg: RGBA.fromInts(235, 244, 246),
    fgMuted: RGBA.fromInts(132, 154, 169),
    cyan: RGBA.fromInts(126, 232, 218),
    green: RGBA.fromInts(123, 229, 180),
    yellow: RGBA.fromInts(255, 203, 116),
    red: RGBA.fromInts(255, 111, 127),
    border: RGBA.fromInts(76, 106, 126),
    selectedBg: RGBA.fromInts(24, 34, 47),
};

const HIDDEN_SCROLLBAR_SIZE = 0;
const SHOW_SCROLLBARS = false;

export type DashboardTab = "overview" | "channels" | "blackboard";

interface TuiSnapshot {
    blackboardTurns: BlackboardTurn[];
    config: FlyflorConfig;
    gateway: GatewayStatusSnapshot;
    loadedAt: string;
    workingMemory: ReturnType<typeof describeWorkingMemoryHealth>;
    workingRecovery: Awaited<ReturnType<typeof describeWorkingMemoryRecoveryFiles>>;
}

const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "channels", label: "Channels" },
    { id: "blackboard", label: "Blackboard" },
];

export function nextDashboardTab(current: DashboardTab, delta: -1 | 1): DashboardTab {
    const index = DASHBOARD_TABS.findIndex((tab) => tab.id === current);
    return DASHBOARD_TABS[(index + delta + DASHBOARD_TABS.length) % DASHBOARD_TABS.length]?.id ?? current;
}

export function renderDashboardLines(
    view: DashboardTab,
    snapshot: TuiSnapshot,
): Array<{ color: RGBA; text: string; bold?: boolean }> {
    const lines: Array<{ color: RGBA; text: string; bold?: boolean }> = [];
    if (view === "overview") {
        lines.push(heading("◆ Runtime"));
        lines.push(normal(`Config: ${snapshot.config.paths.home}/config.jsonc`));
        lines.push(normal(`Gateway: ${snapshot.gateway.host}:${snapshot.gateway.port}`));
        lines.push(normal(`API mode: ${snapshot.config.model.apiMode}`));
        lines.push(normal(`Sandbox: ${snapshot.config.sandbox.mode}`));
        lines.push(
            normal(
                `Memory: ${snapshot.config.memory.enabled ? "enabled" : "disabled"} · Crystal component ${
                    snapshot.config.memory.crystal.enabled ? "enabled" : "disabled"
                } · ${snapshot.config.memory.crystal.backend}`,
            ),
        );
        lines.push({
            text: `Working: ${snapshot.workingMemory.status} · ${snapshot.workingMemory.detail}`,
            color: snapshot.workingMemory.status === "warn" ? THEME.yellow : THEME.fg,
        });
        lines.push(normal(`Recovery: ${snapshot.workingRecovery.status} · ${snapshot.workingRecovery.detail}`));
        lines.push(normal(""));
        lines.push(heading("◆ Latest Blackboard"));
        const turn = snapshot.blackboardTurns[0];
        if (turn) {
            lines.push(normal(`${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`));
            lines.push(muted(turn.goal.slice(0, 200)));
        } else {
            lines.push(muted("No blackboard turn yet."));
        }
    } else if (view === "channels") {
        lines.push(heading("◆ Channels"));
        for (const ch of snapshot.gateway.channels) {
            const stateColor =
                ch.state === "connected" ? THEME.green : ch.state === "degraded" ? THEME.red : THEME.yellow;
            lines.push({ text: `${ch.name} · ${ch.state ?? "unknown"}`, color: stateColor });
            lines.push(muted(`  ${ch.transport} · ${ch.detail ?? ""}`));
            if (ch.lastError) {
                lines.push({ text: `  ! ${ch.lastError.slice(0, 120)}`, color: THEME.red });
            }
        }
    } else {
        lines.push(heading("◆ Blackboard"));
        const turn = snapshot.blackboardTurns[0];
        if (!turn) {
            lines.push(muted("No blackboard turn yet."));
        } else {
            lines.push(normal(`${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`));
            lines.push(muted(`Goal: ${turn.goal.slice(0, 200)}`));
            lines.push(normal(""));
            lines.push({ text: "Transcript", color: THEME.yellow, bold: true });
            for (const msg of turn.messages.filter((m) => m.visibility === "public").slice(-8)) {
                const symbol = msg.role === "system" ? "o" : msg.role === "assistant" ? "<" : ">";
                lines.push(normal(`${symbol} ${msg.role}: ${msg.content.slice(0, 200)}`));
            }
        }
    }
    return lines;
}

export async function startTui(app: FlyFlor): Promise<void> {
    const renderer = await withPinnedAlternateScreen(async () => {
        const instance = await createCliRenderer({
            targetFps: 30,
            exitOnCtrlC: false,
            screenMode: "alternate-screen",
            useMouse: true,
            externalOutputMode: "passthrough",
            consoleOptions: {
                onCopySelection: (text) => {
                    void Bun.write(Bun.stdout, text);
                },
            },
        });
        pinRendererAlternateScreen(instance);
        return instance;
    });

    const loadSnapshot = async (): Promise<TuiSnapshot> => {
        const config = app.resolve(ConfigComponent);
        const gateway = await resolveGatewaySnapshot(app);
        const blackboard = app.resolve(BlackboardModule);
        const blackboardTurns = await blackboard.listRecentTurns(3);
        const workingMemory = describeWorkingMemoryHealth(app.resolve(MemoryModule).getWorkingMemoryHealthSnapshot());
        // Recovery visibility intentionally reads only file metadata, so the dashboard stays cheap to refresh.
        const workingRecovery = await describeWorkingMemoryRecoveryFiles(config);
        return { blackboardTurns, config, gateway, loadedAt: new Date().toISOString(), workingMemory, workingRecovery };
    };

    let view: DashboardTab = "overview";
    let snapshot = await loadSnapshot();
    let err: string | null = null;

    const root = renderer.root;
    const mainBox = new BoxRenderable(renderer, {
        flexDirection: "column",
        width: renderer.width,
        height: renderer.height,
        backgroundColor: THEME.bg,
    });
    const headerBox = new BoxRenderable(renderer, {
        flexDirection: "column",
        border: ["bottom"],
        borderColor: THEME.border,
        padding: 1,
        flexShrink: 0,
    });
    const headerTitle = new TextRenderable(renderer, {
        content: "Flyflor Dashboard",
        fg: THEME.cyan,
        attributes: TextAttributes.BOLD,
    });
    const headerMeta = new TextRenderable(renderer, { content: "", fg: THEME.fgMuted, selectable: true });
    const headerHelp = new TextRenderable(renderer, {
        content: "q/Esc quit · h/l arrows switch · r refresh",
        fg: THEME.fgMuted,
        selectable: false,
    });
    const errorText = new TextRenderable(renderer, { content: "", fg: THEME.red, selectable: true });
    errorText.visible = false;
    headerBox.add(headerTitle);
    headerBox.add(headerMeta);
    headerBox.add(headerHelp);
    headerBox.add(errorText);
    mainBox.add(headerBox);

    const row = new BoxRenderable(renderer, { flexDirection: "row", flexGrow: 1, flexShrink: 1 });
    mainBox.add(row);
    const sidebar = new BoxRenderable(renderer, {
        flexDirection: "column",
        border: ["right"],
        borderColor: THEME.border,
        padding: 1,
        width: 20,
        flexShrink: 0,
    });
    const sidebarTitle = new TextRenderable(renderer, {
        content: "Views",
        fg: THEME.yellow,
        attributes: TextAttributes.BOLD,
        selectable: false,
    });
    sidebar.add(sidebarTitle);
    const tabTexts = DASHBOARD_TABS.map((tab) => {
        const text = new TextRenderable(renderer, { content: "", fg: THEME.fg, selectable: false });
        sidebar.add(text);
        return { tab, text };
    });
    row.add(sidebar);

    const content = new ScrollBoxRenderable(renderer, {
        contentOptions: { flexDirection: "column" },
        flexGrow: 1,
        flexShrink: 1,
        padding: 1,
        horizontalScrollbarOptions: { height: HIDDEN_SCROLLBAR_SIZE, visible: SHOW_SCROLLBARS },
        verticalScrollbarOptions: {
            visible: SHOW_SCROLLBARS,
            width: HIDDEN_SCROLLBAR_SIZE,
            showArrows: false,
        },
    });
    useDetachedScrollBars(content);
    row.add(content);
    root.add(mainBox);

    const lineRenderables: TextRenderable[] = [];

    const refresh = async () => {
        try {
            snapshot = await loadSnapshot();
            err = null;
        } catch (e) {
            err = e instanceof Error ? e.message : String(e);
        }
        syncUi();
    };
    const timer = setInterval(() => void refresh(), 2000);

    const keyHandler = (event: {
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
        sequence?: string;
    }) => {
        const name = event.name ?? "";
        if (name === "q" || name === "escape") {
            lifecycle.destroy();
            return;
        }
        if (name === "left" || name === "h") {
            view = nextDashboardTab(view, -1);
            content.scrollTo({ x: content.scrollLeft, y: 0 });
            syncUi();
        }
        if (name === "right" || name === "l") {
            view = nextDashboardTab(view, 1);
            content.scrollTo({ x: content.scrollLeft, y: 0 });
            syncUi();
        }
        if (name === "r") void refresh();
    };

    function syncUi(): void {
        headerMeta.content = `${snapshot.config.model.providerId}/${snapshot.config.model.model} · ${
            snapshot.gateway.gatewayRunning ? "gateway running" : "gateway stopped"
        } · channels ${snapshot.gateway.connectedCount}/${snapshot.gateway.channels.length}`;
        errorText.content = err ? `Error: ${err}` : "";
        errorText.visible = Boolean(err);
        for (const item of tabTexts) {
            const active = item.tab.id === view;
            item.text.content = `${active ? "> " : "  "}${item.tab.label}`;
            item.text.fg = active ? THEME.cyan : THEME.fg;
            item.text.attributes = active ? TextAttributes.BOLD : TextAttributes.NONE;
        }
        const lines = renderDashboardLines(view, snapshot);
        while (lineRenderables.length > lines.length) {
            const stale = lineRenderables.pop()!;
            content.content.remove(stale.id);
        }
        for (let index = lineRenderables.length; index < lines.length; index += 1) {
            const line = lines[index]!;
            const text = new TextRenderable(renderer, {
                content: line.text,
                fg: line.color,
                attributes: line.bold ? TextAttributes.BOLD : TextAttributes.NONE,
                selectable: true,
                width: "100%",
                wrapMode: "word",
            });
            lineRenderables.push(text);
            content.content.add(text);
        }
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            const text = lineRenderables[index]!;
            text.content = line.text;
            text.fg = line.color;
            text.attributes = line.bold ? TextAttributes.BOLD : TextAttributes.NONE;
        }
        renderer.requestRender();
    }

    const resizeHandler = () => {
        mainBox.width = renderer.width;
        mainBox.height = renderer.height;
    };
    renderer.on(CliRenderEvents.RESIZE, resizeHandler);
    renderer.keyInput.on("keypress", keyHandler);
    const lifecycle = createTuiLifecycle(renderer, {
        cleanup: () => {
            renderer.keyInput.off("keypress", keyHandler);
            renderer.off(CliRenderEvents.RESIZE, resizeHandler);
            clearInterval(timer);
            root.remove(mainBox.id);
        },
    });
    syncUi();
    return lifecycle.waitForDestroy();
}

function heading(text: string): { color: RGBA; text: string; bold: true } {
    return { text, color: THEME.cyan, bold: true };
}

function normal(text: string): { color: RGBA; text: string } {
    return { text, color: THEME.fg };
}

function muted(text: string): { color: RGBA; text: string } {
    return { text, color: THEME.fgMuted };
}

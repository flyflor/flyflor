/**
 * Flyflor Dashboard TUI — 基于 @opentui/core + @opentui/solid
 *
 * 简化版：显示 Overview / Channels / Blackboard 三个标签页。
 */

import { createCliRenderer, Box, Text, ScrollBox, RGBA, TextAttributes, type CliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { createSignal, createMemo, onCleanup } from "solid-js";
import type { FlyFlor } from "../../app.ts";
import { FlyFlorTokens } from "../../app.ts";
import { resolveGatewaySnapshot } from "../../command/cli/status.ts";
import type { GatewayStatusSnapshot } from "../../agent/gateway/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/index.ts";
import type { FlyflorConfig } from "../../config/index.ts";

const THEME = {
    bg: RGBA.fromInts(15, 15, 15),
    fg: RGBA.fromInts(220, 220, 220),
    fgMuted: RGBA.fromInts(120, 120, 120),
    cyan: RGBA.fromInts(100, 200, 255),
    green: RGBA.fromInts(100, 255, 150),
    yellow: RGBA.fromInts(255, 200, 100),
    red: RGBA.fromInts(255, 80, 80),
    border: RGBA.fromInts(60, 60, 60),
};

type ViewTab = "overview" | "channels" | "blackboard";

interface TuiSnapshot {
    blackboardTurns: BlackboardTurn[];
    config: FlyflorConfig;
    gateway: GatewayStatusSnapshot;
    loadedAt: string;
}

export async function startTui(app: FlyFlor): Promise<void> {
    const renderer = await createCliRenderer({
        targetFps: 30,
        exitOnCtrlC: false,
        useMouse: true,
        externalOutputMode: "passthrough",
        consoleOptions: {
            onCopySelection: (text) => {
                try {
                    Bun.write(Bun.stdout, text);
                } catch {}
            },
        },
    });

    const loadSnapshot = async (): Promise<TuiSnapshot> => {
        const config = app.resolve(FlyFlorTokens.Config);
        const gateway = await resolveGatewaySnapshot(app);
        const blackboard = app.resolve(FlyFlorTokens.Blackboard);
        const blackboardTurns = await blackboard.listRecentTurns(3);
        return { blackboardTurns, config, gateway, loadedAt: new Date().toISOString() };
    };

    const initialSnapshot = await loadSnapshot();
    const [view, setView] = createSignal<ViewTab>("overview");
    const [snapshot, setSnapshot] = createSignal<TuiSnapshot>(initialSnapshot);
    const [err, setErr] = createSignal<string | null>(null);

    const refresh = async () => {
        try {
            setSnapshot(await loadSnapshot());
            setErr(null);
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
    };

    const timer = setInterval(() => void refresh(), 2000);
    onCleanup(() => clearInterval(timer));

    const tabs: { id: ViewTab; label: string }[] = [
        { id: "overview", label: "Overview" },
        { id: "channels", label: "Channels" },
        { id: "blackboard", label: "Blackboard" },
    ];

    const cycleView = (delta: number) => {
        const order: ViewTab[] = ["overview", "channels", "blackboard"];
        const idx = order.indexOf(view());
        setView(order[(idx + delta + order.length) % order.length] ?? "overview");
    };

    const header = createMemo(() => {
        const s = snapshot();
        return Box(
            { flexDirection: "column", border: ["bottom"], borderColor: THEME.border, padding: 1, flexShrink: 0 },
            Text({ content: "Flyflor Dashboard", fg: THEME.cyan, attributes: TextAttributes.BOLD }),
            Text({
                content: `${s.config.model.providerId}/${s.config.model.model}  ·  ${s.gateway.gatewayRunning ? "gateway running" : "gateway stopped"}  ·  channels ${s.gateway.connectedCount}/${s.gateway.channels.length}`,
                fg: THEME.fgMuted,
            }),
            Text({ content: "q/Esc quit  ·  h/l arrows switch  ·  r refresh", fg: THEME.fgMuted }),
            err() ? Text({ content: `Error: ${err()}`, fg: THEME.red }) : undefined,
        );
    });

    const sidebar = createMemo(() => {
        return Box(
            { flexDirection: "column", border: ["right"], borderColor: THEME.border, padding: 1, width: 20, flexShrink: 0 },
            Text({ content: "Views", fg: THEME.yellow, attributes: TextAttributes.BOLD }),
            ...tabs.map((tab) =>
                Text({
                    content: `${tab.id === view() ? "▶ " : "  "}${tab.label}`,
                    fg: tab.id === view() ? THEME.cyan : THEME.fg,
                }),
            ),
        );
    });

    const content = createMemo(() => {
        const s = snapshot();
        const lines: ReturnType<typeof Text>[] = [];
        if (view() === "overview") {
            lines.push(Text({ content: "◆ Runtime", fg: THEME.cyan, attributes: TextAttributes.BOLD }));
            lines.push(Text({ content: `Config: ${s.config.paths.home}/config.jsonc`, fg: THEME.fg }));
            lines.push(Text({ content: `Gateway: ${s.gateway.host}:${s.gateway.port}`, fg: THEME.fg }));
            lines.push(Text({ content: `API mode: ${s.config.model.apiMode}`, fg: THEME.fg }));
            lines.push(Text({ content: `Sandbox: ${s.config.sandbox.mode}`, fg: THEME.fg }));
            lines.push(Text({ content: `Memory: ${s.config.memory.enabled ? "enabled" : "disabled"} · Crystal ${s.config.memory.crystal.enabled ? "enabled" : "disabled"}`, fg: THEME.fg }));
            lines.push(Text({ content: "" }));
            lines.push(Text({ content: "◆ Latest Blackboard", fg: THEME.cyan, attributes: TextAttributes.BOLD }));
            const turn = s.blackboardTurns[0];
            if (turn) {
                lines.push(Text({ content: `${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`, fg: THEME.fg }));
                lines.push(Text({ content: turn.goal.slice(0, 200), fg: THEME.fgMuted }));
            } else {
                lines.push(Text({ content: "No blackboard turn yet.", fg: THEME.fgMuted }));
            }
        } else if (view() === "channels") {
            lines.push(Text({ content: "◆ Channels", fg: THEME.cyan, attributes: TextAttributes.BOLD }));
            for (const ch of s.gateway.channels) {
                const stateColor = ch.state === "connected" ? THEME.green : ch.state === "degraded" ? THEME.red : THEME.yellow;
                lines.push(Text({ content: `${ch.name} · ${ch.state ?? "unknown"}`, fg: stateColor }));
                lines.push(Text({ content: `  ${ch.transport} · ${ch.detail ?? ""}`, fg: THEME.fgMuted }));
                if (ch.lastError) {
                    lines.push(Text({ content: `  ⚠ ${ch.lastError.slice(0, 120)}`, fg: THEME.red }));
                }
            }
        } else {
            lines.push(Text({ content: "◆ Blackboard", fg: THEME.cyan, attributes: TextAttributes.BOLD }));
            const turn = s.blackboardTurns[0];
            if (!turn) {
                lines.push(Text({ content: "No blackboard turn yet.", fg: THEME.fgMuted }));
            } else {
                lines.push(Text({ content: `${turn.status} · ${turn.steps.length} steps · ${turn.decisions.length} decisions`, fg: THEME.fg }));
                lines.push(Text({ content: `Goal: ${turn.goal.slice(0, 200)}`, fg: THEME.fgMuted }));
                lines.push(Text({ content: "" }));
                lines.push(Text({ content: "Transcript", fg: THEME.yellow, attributes: TextAttributes.BOLD }));
                for (const msg of turn.messages.filter((m) => m.visibility === "public").slice(-8)) {
                    const symbol = msg.role === "system" ? "◦" : msg.role === "assistant" ? "↩" : "↘";
                    lines.push(Text({ content: `${symbol} ${msg.role}: ${msg.content.slice(0, 200)}`, fg: THEME.fg }));
                }
            }
        }
        return ScrollBox(
            { flexGrow: 1, flexDirection: "column", padding: 1 },
            ...lines,
        );
    });

    void render(() => {
        const width = renderer.width;
        const height = renderer.height;

        return Box(
            {
                flexDirection: "column",
                width,
                height,
                backgroundColor: THEME.bg,
            },
            header(),
            Box(
                { flexDirection: "row", flexGrow: 1 },
                sidebar(),
                content(),
            ),
        );
    }, renderer);

    const keyHandler = (event: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }) => {
        const name = event.name ?? "";
        if (name === "q" || name === "escape") {
            renderer.destroy();
            return;
        }
        if (name === "left" || name === "h") cycleView(-1);
        if (name === "right" || name === "l") cycleView(1);
        if (name === "r") void refresh();
    };

    renderer.keyInput.on("keypress", keyHandler);

    return new Promise<void>((resolve) => {
        renderer.once("destroy", () => {
            renderer.keyInput.off("keypress", keyHandler);
            clearInterval(timer);
            renderer.destroy();
            resolve();
        });
    });
}

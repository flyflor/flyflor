/**
 * Flyflor CLI TUI — 基于 @opentui/core 命令式 renderable API
 *
 * 简化版：为各 CLI 命令提供通用文本浏览界面。
 */

import {
    BoxRenderable,
    CliRenderEvents,
    createCliRenderer,
    RGBA,
    ScrollBoxRenderable,
    TextAttributes,
    TextRenderable} from "@opentui/core";
import type { FlyFlor } from "../../../app.ts";
import { ConfigComponent } from "../../../config/index.ts";
import { fetchOverviewData } from "../../cli/handlers/overview.handler.ts";
import { fetchConfigData } from "../../cli/handlers/config.handler.ts";
import { getFlyflorConfigPath } from "../../cli/config.ts";
import { fetchSkillList } from "../../cli/handlers/skills.handler.ts";
import { fetchMcpServerList } from "../../cli/handlers/mcp.handler.ts";
import { fetchPluginList } from "../../cli/handlers/plugins.handler.ts";
import { fetchSandboxData } from "../../cli/handlers/sandbox.handler.ts";
import { fetchBlackboardTurnList } from "../../cli/handlers/blackboard.handler.ts";
import { fetchMemoryData } from "../../cli/handlers/memory.handler.ts";
import { fetchGhostList } from "../../cli/handlers/ghost.list.handler.ts";
import { fetchDreamData } from "../../cli/handlers/dream.handler.ts";
import { copyTextToTerminalClipboard } from "../chat/clipboard.ts";
import { createTuiLifecycle } from "../lifecycle.ts";
import {
    CLI_TUI_PAGE_ITEMS,
    listCliTuiPages,
    nextGenericCliTuiPage,
    type CliPage,
    type GenericCliPage} from "./command.route.ts";

export { listCliTuiPages, nextCliTuiPage, resolveCommandTuiPage, type CliPage } from "./command.route.ts";

const THEME = {
    bg: RGBA.fromInts(13, 19, 29),
    fg: RGBA.fromInts(235, 244, 246),
    fgMuted: RGBA.fromInts(132, 154, 169),
    cyan: RGBA.fromInts(126, 232, 218),
    green: RGBA.fromInts(123, 229, 180),
    yellow: RGBA.fromInts(255, 203, 116),
    pink: RGBA.fromInts(255, 151, 190),
    purple: RGBA.fromInts(188, 171, 255),
    red: RGBA.fromInts(255, 111, 127),
    border: RGBA.fromInts(76, 106, 126),
    selectedBg: RGBA.fromInts(24, 34, 47)};

interface PageLoader {
    title: string;
    load: (app: FlyFlor) => Promise<string[]>;
}

function overviewLoader(): PageLoader {
    return {
        title: "Overview",
        async load(app) {
            const data = await fetchOverviewData(app);
            const lines: string[] = [];
            lines.push("◆ Runtime");
            lines.push(`  Config: ${data.runtime.configPath}`);
            lines.push(`  Home: ${data.runtime.home}`);
            lines.push(`  Model: ${data.runtime.model}`);
            lines.push(`  API: ${data.runtime.apiMode}`);
            lines.push(`  Sandbox: ${data.runtime.sandbox}`);
            lines.push("");
            lines.push("◆ Gateway");
            lines.push(`  Running: ${data.gateway.running ? "yes" : "no"}`);
            lines.push(`  URL: ${data.gateway.url}`);
            lines.push(`  Connected: ${data.gateway.connectedCount}/${data.gateway.totalCount}`);
            lines.push("");
            lines.push("◆ Channels");
            for (const ch of data.channels) {
                lines.push(`  ${ch.name} · ${ch.state} · ${ch.transport}`);
                if (ch.detail) lines.push(`    ${ch.detail}`);
                if (ch.lastError) lines.push(`    ⚠ ${ch.lastError}`);
            }
            lines.push("");
            lines.push("◆ Memory");
            lines.push(`  Enabled: ${data.memory.memoryEnabled ? "yes" : "no"}`);
            lines.push(`  Crystal: ${data.memory.crystalEnabled ? "yes" : "no"}`);
            lines.push(`  Working: ${data.memory.workingMemoryStatus.status} · ${data.memory.workingMemoryStatus.detail}`);
            lines.push(`  Recovery: ${data.memory.workingRecoveryStatus.status} · ${data.memory.workingRecoveryStatus.detail}`);
            lines.push("");
            lines.push("◆ Doctor");
            for (const check of data.doctor) {
                const icon = check.status === "ok" ? "✓" : "✗";
                lines.push(`  ${icon} ${check.name}: ${check.detail}`);
            }
            return lines;
        }};
}

function configLoader(): PageLoader {
    return {
        title: "Config",
        async load(app) {
            const data = fetchConfigData(app, getFlyflorConfigPath());
            const lines: string[] = [];
            lines.push("◆ Model");
            lines.push(`  Provider: ${data.model.provider}`);
            lines.push(`  Model: ${data.model.model}`);
            lines.push(`  API Mode: ${data.model.apiMode}`);
            lines.push("");
            lines.push("◆ Gateway");
            lines.push(`  Host: ${data.gateway.host}`);
            lines.push(`  Port: ${String(data.gateway.port)}`);
            lines.push("");
            lines.push("◆ Sandbox");
            lines.push(`  Mode: ${data.sandbox.mode}`);
            lines.push("");
            lines.push("◆ Memory");
            lines.push(`  Enabled: ${data.memory.enabled ? "yes" : "no"}`);
            lines.push(`  Embedding: ${data.memory.embeddingDimensions}d`);
            return lines;
        }};
}

function skillsLoader(): PageLoader {
    return {
        title: "Skills",
        async load(app) {
            const paths = app.resolve(ConfigComponent).paths;
            const items = await fetchSkillList(paths);
            const lines: string[] = [];
            lines.push(`◆ Skills (${items.length})`);
            for (const item of items) {
                lines.push(`  · ${item.name} · ${item.version ?? "?"}`);
                if (item.description) lines.push(`    ${item.description}`);
            }
            return lines;
        }};
}

function mcpLoader(): PageLoader {
    return {
        title: "MCP Servers",
        async load(app) {
            const paths = app.resolve(ConfigComponent).paths;
            const items = await fetchMcpServerList(paths);
            const lines: string[] = [];
            lines.push(`◆ MCP Servers (${items.length})`);
            for (const item of items) {
                const status = item.enabled ? "●" : "○";
                lines.push(`  ${status} ${item.name} · ${item.transport}`);
                if (item.toolCount !== undefined) lines.push(`    Tools: ${item.toolCount}`);
            }
            return lines;
        }};
}

function pluginsLoader(): PageLoader {
    return {
        title: "Plugins",
        async load(app) {
            const paths = app.resolve(ConfigComponent).paths;
            const items = await fetchPluginList(paths);
            const lines: string[] = [];
            lines.push(`◆ Plugins (${items.length})`);
            for (const item of items) {
                const status = item.enabled ? "●" : "○";
                lines.push(`  ${status} ${item.name}`);
            }
            return lines;
        }};
}

function sandboxLoader(): PageLoader {
    return {
        title: "Sandbox",
        async load(app) {
            const paths = app.resolve(ConfigComponent).paths;
            const data = await fetchSandboxData(paths);
            const lines: string[] = [];
            lines.push("◆ Sandbox");
            lines.push(`  Plugin commands: ${data.pluginCommands.length}`);
            for (const entry of data.pluginCommands) {
                lines.push(`    · ${entry.value} (${entry.source})`);
            }
            lines.push(`  Shell commands: ${data.shellCommands.length}`);
            for (const entry of data.shellCommands) {
                lines.push(`    · ${entry.value} (${entry.source})`);
            }
            lines.push(`  MCP tools: ${data.mcpTools.length}`);
            for (const entry of data.mcpTools) {
                lines.push(`    · ${entry.value} (${entry.source})`);
            }
            return lines;
        }};
}

function blackboardLoader(): PageLoader {
    return {
        title: "Blackboard",
        async load(app) {
            const items = await fetchBlackboardTurnList(app, 10);
            const lines: string[] = [];
            lines.push(`◆ Blackboard Turns (${items.length})`);
            for (const item of items) {
                lines.push(`  ${item.status} · ${item.goal.slice(0, 80)}`);
                lines.push(`    Steps: ${item.stepCount} · Workers: ${item.workerCount} · ${item.updatedAt}`);
            }
            return lines;
        }};
}

function memoryLoader(): PageLoader {
    return {
        title: "Memory",
        async load(app) {
            const data = await fetchMemoryData(app);
            const lines: string[] = [];
            lines.push("◆ Memory");
            lines.push(`  Enabled: ${data.enabled ? "yes" : "no"}`);
            lines.push(`  Crystal: ${data.crystalEnabled ? "yes" : "no"}`);
            lines.push(`  Crystal component: ${data.crystalBackend}`);
            lines.push(`  SQLite: ${data.sqliteEnabled ? "yes" : "no"}`);
            lines.push(`  Embedding: ${data.embeddingDimensions}d`);
            lines.push(`  Working: ${data.workingMemoryStatus.status} · ${data.workingMemoryStatus.detail}`);
            lines.push(`  Recovery: ${data.workingRecoveryStatus.status} · ${data.workingRecoveryStatus.detail}`);
            lines.push(`  Retrospective: ${data.retrospectiveEntryCount} entries`);
            return lines;
        }};
}

function ghostsLoader(): PageLoader {
    return {
        title: "Ghosts",
        async load(app) {
            const data = await fetchGhostList(app, "human", 60);
            const lines: string[] = [];
            lines.push(`◆ Ghosts (${data.total})`);
            if (!data.present) {
                lines.push("  Brain database not found.");
                return lines;
            }
            for (const group of data.groups) {
                lines.push(`  [${group.label}]`);
                for (const g of group.items.slice(0, 10)) {
                    lines.push(`    ${g.status} · ${g.reason.slice(0, 80)}`);
                }
            }
            return lines;
        }};
}

function dreamLoader(): PageLoader {
    return {
        title: "Dream",
        async load(app) {
            const data = fetchDreamData(app);
            const lines: string[] = [];
            lines.push("◆ Dream");
            lines.push(`  Enabled: ${data.enabled ? "yes" : "no"}`);
            lines.push(`  Busy: ${data.busy ? "yes" : "no"}`);
            lines.push(`  Users: ${data.users}`);
            return lines;
        }};
}

function getLoader(page: CliPage): PageLoader {
    switch (page) {
        case "overview":
            return overviewLoader();
        case "config":
            return configLoader();
        case "skills":
            return skillsLoader();
        case "mcp":
            return mcpLoader();
        case "plugins":
            return pluginsLoader();
        case "sandbox":
            return sandboxLoader();
        case "blackboard":
            return blackboardLoader();
        case "memory":
            return memoryLoader();
        case "ghosts":
            return ghostsLoader();
        case "dream":
            return dreamLoader();
    }
}

export async function startCliTui(app: FlyFlor, initialPage: CliPage): Promise<void> {
    if (initialPage === "blackboard") {
        const { startBlackboardBrowser } = await import("./blackboard.browser.tsx");
        await startBlackboardBrowser(app);
        return;
    }
    const firstPage: GenericCliPage = initialPage;

    const renderer = await createCliRenderer({
        targetFps: 30,
        exitOnCtrlC: false,
        screenMode: "alternate-screen",
        consoleMode: "disabled",
        useMouse: true,
        enableMouseMovement: true,
        externalOutputMode: "passthrough",
        consoleOptions: {
            onCopySelection: (text) => {
                copyTextToTerminalClipboard(text);
                renderer.clearSelection();
            }}});

    let activePage = firstPage;
    let lines: string[] = [];
    let err: string | null = null;
    let status = "Ready";
    let refreshToken = 0;
    let destroyed = false;

    const root = renderer.root;
    const mainBox = new BoxRenderable(renderer, {
        backgroundColor: THEME.bg,
        flexDirection: "column",
        height: renderer.height,
        width: renderer.width});
    const headerBox = new BoxRenderable(renderer, {
        border: ["bottom"],
        borderColor: THEME.border,
        flexDirection: "column",
        flexShrink: 0,
        padding: 1});
    const headerTitle = new TextRenderable(renderer, {
        content: "",
        fg: THEME.cyan,
        attributes: TextAttributes.BOLD});
    const headerHelp = new TextRenderable(renderer, {
        content: "↑/↓ select page · r refresh · q/Esc quit · Cmd/Ctrl+C copy selection",
        fg: THEME.fgMuted,
        selectable: false});
    const errorText = new TextRenderable(renderer, {
        content: "",
        fg: THEME.red,
        selectable: true});
    errorText.visible = false;
    headerBox.add(headerTitle);
    headerBox.add(headerHelp);
    headerBox.add(errorText);
    mainBox.add(headerBox);

    const bodyBox = new BoxRenderable(renderer, {
        flexDirection: "row",
        flexGrow: 1,
        flexShrink: 1});
    mainBox.add(bodyBox);

    const navBox = new BoxRenderable(renderer, {
        border: ["right"],
        borderColor: THEME.border,
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        width: navWidthFor(renderer.width)});
    bodyBox.add(navBox);

    const navItems = CLI_TUI_PAGE_ITEMS.map((item, index) => {
        const box = new BoxRenderable(renderer, {
            flexDirection: "column",
            paddingBottom: 0,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: index === 0 ? 0 : 1});
        const title = new TextRenderable(renderer, { content: "", fg: THEME.fg, selectable: false });
        const detail = new TextRenderable(renderer, { content: "", fg: THEME.fgMuted, selectable: false });
        box.add(title);
        box.add(detail);
        navBox.add(box);
        return { box, detail, item, title };
    });

    const contentBox = new ScrollBoxRenderable(renderer, {
        contentOptions: { flexDirection: "column" },
        flexGrow: 1,
        flexShrink: 1,
        padding: 1,
        horizontalScrollbarOptions: { height: 0, visible: false },
        verticalScrollbarOptions: {
            visible: true,
            width: 2,
            showArrows: false,
            trackOptions: {
                backgroundColor: THEME.selectedBg,
                foregroundColor: THEME.purple}}});
    contentBox.horizontalScrollBar.visible = false;
    contentBox.horizontalScrollBar.height = 0;
    bodyBox.add(contentBox);

    const statusBox = new BoxRenderable(renderer, {
        backgroundColor: THEME.selectedBg,
        flexShrink: 0,
        height: 1,
        paddingLeft: 1,
        paddingRight: 1});
    const statusText = new TextRenderable(renderer, {
        content: status,
        fg: THEME.fgMuted,
        selectable: false,
        truncate: true});
    statusBox.add(statusText);
    mainBox.add(statusBox);
    root.add(mainBox);

    const lineRenderables: TextRenderable[] = [];

    const refresh = async (page = activePage) => {
        const token = ++refreshToken;
        const currentLoader = getLoader(page);
        status = `Loading ${currentLoader.title}...`;
        syncUi();
        try {
            const nextLines = await currentLoader.load(app);
            if (token !== refreshToken) return;
            lines = nextLines;
            err = null;
            status = `Loaded ${currentLoader.title}`;
            syncUi();
        } catch (e) {
            if (token !== refreshToken) return;
            err = e instanceof Error ? e.message : String(e);
            status = "Load failed";
            syncUi();
        }
    };

    const keyHandler = (event: {
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
        sequence?: string;
        preventDefault?: () => void;
        stopPropagation?: () => void;
    }) => {
        const name = event.name ?? "";
        if (name === "q" || name === "escape") {
            lifecycle.destroy();
            return;
        }
        if (event.ctrl && name === "c") {
            lifecycle.destroy();
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        if (name === "up" || name === "k") {
            movePage(-1);
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        if (name === "down" || name === "j") {
            movePage(1);
            event.preventDefault?.();
            event.stopPropagation?.();
            return;
        }
        if (name === "r") void refresh();
    };

    function movePage(delta: -1 | 1): void {
        const next = nextGenericCliTuiPage(activePage, delta);
        if (next === activePage) return;
        activePage = next;
        contentBox.scrollTo({ x: contentBox.scrollLeft, y: 0 });
        syncUi();
        void refresh(next);
    }

    function syncUi(): void {
        const currentLoader = getLoader(activePage);
        headerTitle.content = `Flyflor · ${currentLoader.title}`;
        errorText.content = err ? `Error: ${err}` : "";
        errorText.visible = Boolean(err);
        statusText.content = status;
        for (const entry of navItems) {
            const active = entry.item.page === activePage;
            entry.box.backgroundColor = active ? THEME.selectedBg : undefined;
            entry.title.content = `${active ? ">" : " "} ${entry.item.title}`;
            entry.title.fg = active ? THEME.pink : THEME.fg;
            entry.title.attributes = active ? TextAttributes.BOLD : TextAttributes.NONE;
            entry.detail.content = `  ${entry.item.detail}`;
        }
        while (lineRenderables.length > lines.length) {
            const stale = lineRenderables.pop()!;
            contentBox.content.remove(stale.id);
        }
        for (let index = lineRenderables.length; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            const renderable = new TextRenderable(renderer, {
                content: line,
                fg: lineColor(line),
                attributes: line.startsWith("◆") ? TextAttributes.BOLD : TextAttributes.NONE,
                selectable: true,
                width: "100%",
                wrapMode: "word"});
            lineRenderables.push(renderable);
            contentBox.content.add(renderable);
        }
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            const renderable = lineRenderables[index]!;
            renderable.content = line;
            renderable.fg = lineColor(line);
            renderable.attributes = line.startsWith("◆") ? TextAttributes.BOLD : TextAttributes.NONE;
        }
        renderer.requestRender();
    }

    function lineColor(line: string): RGBA {
        if (line.startsWith("◆")) return THEME.cyan;
        if (line.startsWith("  ✓")) return THEME.green;
        if (line.startsWith("  ✗") || line.startsWith("⚠")) return THEME.red;
        return THEME.fg;
    }

    const resizeHandler = () => {
        mainBox.width = renderer.width;
        mainBox.height = renderer.height;
        navBox.width = navWidthFor(renderer.width);
    };
    renderer.on(CliRenderEvents.RESIZE, resizeHandler);
    renderer.keyInput.on("keypress", keyHandler);
    const lifecycle = createTuiLifecycle(renderer, {
        cleanup: () => {
            destroyed = true;
            renderer.keyInput.off("keypress", keyHandler);
            renderer.off(CliRenderEvents.RESIZE, resizeHandler);
            root.remove(mainBox.id);
        }});
    syncUi();
    void refresh(initialPage);

    return lifecycle.waitForDestroy();
}

function navWidthFor(width: number): number {
    return Math.min(30, Math.max(22, Math.floor(width * 0.22)));
}

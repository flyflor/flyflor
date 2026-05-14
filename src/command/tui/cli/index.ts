/**
 * Flyflor CLI TUI — 基于 @opentui/core + @opentui/solid
 *
 * 简化版：为各 CLI 命令提供通用文本浏览界面。
 */

import { createCliRenderer, Box, Text, ScrollBox, RGBA, TextAttributes, type CliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { createSignal, createMemo, onCleanup } from "solid-js";
import type { FlyFlor } from "../../../app.ts";
import { FlyFlorTokens } from "../../../app.ts";
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

export type CliPage =
    | "overview"
    | "config"
    | "skills"
    | "mcp"
    | "plugins"
    | "sandbox"
    | "blackboard"
    | "memory"
    | "ghosts"
    | "dream";

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
            lines.push("");
            lines.push("◆ Doctor");
            for (const check of data.doctor) {
                const icon = check.status === "ok" ? "✓" : "✗";
                lines.push(`  ${icon} ${check.name}: ${check.detail}`);
            }
            return lines;
        },
    };
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
        },
    };
}

function skillsLoader(): PageLoader {
    return {
        title: "Skills",
        async load(app) {
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const items = await fetchSkillList(paths);
            const lines: string[] = [];
            lines.push(`◆ Skills (${items.length})`);
            for (const item of items) {
                lines.push(`  · ${item.name} · ${item.version ?? "?"}`);
                if (item.description) lines.push(`    ${item.description}`);
            }
            return lines;
        },
    };
}

function mcpLoader(): PageLoader {
    return {
        title: "MCP Servers",
        async load(app) {
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const items = await fetchMcpServerList(paths);
            const lines: string[] = [];
            lines.push(`◆ MCP Servers (${items.length})`);
            for (const item of items) {
                const status = item.enabled ? "●" : "○";
                lines.push(`  ${status} ${item.name} · ${item.transport}`);
                if (item.toolCount !== undefined) lines.push(`    Tools: ${item.toolCount}`);
            }
            return lines;
        },
    };
}

function pluginsLoader(): PageLoader {
    return {
        title: "Plugins",
        async load(app) {
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const items = await fetchPluginList(paths);
            const lines: string[] = [];
            lines.push(`◆ Plugins (${items.length})`);
            for (const item of items) {
                const status = item.enabled ? "●" : "○";
                lines.push(`  ${status} ${item.name}`);
            }
            return lines;
        },
    };
}

function sandboxLoader(): PageLoader {
    return {
        title: "Sandbox",
        async load(app) {
            const paths = app.resolve(FlyFlorTokens.Config).paths;
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
        },
    };
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
        },
    };
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
            lines.push(`  Redis: ${data.redisEnabled ? "yes" : "no"}`);
            lines.push(`  Surreal: ${data.surrealEnabled ? "yes" : "no"}`);
            lines.push(`  SQLite: ${data.sqliteEnabled ? "yes" : "no"}`);
            lines.push(`  Embedding: ${data.embeddingDimensions}d`);
            lines.push(`  Retrospective: ${data.retrospectiveEntryCount} entries`);
            return lines;
        },
    };
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
        },
    };
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
        },
    };
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

    const loader = getLoader(initialPage);
    const [lines, setLines] = createSignal<string[]>([]);
    const [err, setErr] = createSignal<string | null>(null);

    const refresh = async () => {
        try {
            setLines(await loader.load(app));
            setErr(null);
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        }
    };

    await refresh();

    const lineNodes = createMemo(() =>
        lines().map((line) =>
            Text({
                content: line,
                fg: line.startsWith("◆") ? THEME.cyan : line.startsWith("  ✓") ? THEME.green : line.startsWith("  ✗") || line.startsWith("⚠") ? THEME.red : THEME.fg,
                attributes: line.startsWith("◆") ? TextAttributes.BOLD : undefined,
            }),
        ),
    );

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
            Box(
                { flexDirection: "column", border: ["bottom"], borderColor: THEME.border, padding: 1, flexShrink: 0 },
                Text({ content: `Flyflor · ${loader.title}`, fg: THEME.cyan, attributes: TextAttributes.BOLD }),
                Text({ content: "q/Esc quit · r refresh", fg: THEME.fgMuted }),
                err() ? Text({ content: `Error: ${err()}`, fg: THEME.red }) : undefined,
            ),
            ScrollBox(
                { flexGrow: 1, flexDirection: "column", padding: 1 },
                ...lineNodes(),
            ),
        );
    }, renderer);

    const keyHandler = (event: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }) => {
        const name = event.name ?? "";
        if (name === "q" || name === "escape") {
            renderer.destroy();
            return;
        }
        if (name === "r") void refresh();
    };

    renderer.keyInput.on("keypress", keyHandler);

    return new Promise<void>((resolve) => {
        renderer.once("destroy", () => {
            renderer.keyInput.off("keypress", keyHandler);
            renderer.destroy();
            resolve();
        });
    });
}

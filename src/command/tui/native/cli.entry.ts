/**
 * CLI TUI 入口 — 基于 ANSI 直接控制的仪表盘。
 *
 * 替代 cli/cli.tui.tsx + 9 个 page 组件。
 * 零 React/Ink 依赖，复用 Screen 双缓冲引擎。
 *
 * 页面：overview | config | skills | mcp | plugins | sandbox | blackboard | memory | dream
 * 键盘：h/l Tab 切换页面 · j/k 选择 · Enter 详情 · Esc 返回 · r 刷新 · q 退出
 */

import { Screen } from "./screen.ts";
import type { KeyEvent } from "./screen.ts";
import type { FlyFlor } from "../../../app.ts";
import { FlyFlorTokens } from "../../../app.ts";
import type { FlyflorConfig } from "../../../config/index.ts";
import { getFlyflorConfigPath } from "../../cli/config.ts";
import { fetchOverviewData, type OverviewData } from "../../cli/handlers/overview.handler.ts";
import { fetchConfigData, type ConfigData } from "../../cli/handlers/config.handler.ts";
import {
    fetchSkillList,
    fetchSkillDetail,
    validateSkills,
    type SkillListItem,
    type SkillDetail,
    type SkillValidationView,
} from "../../cli/handlers/skills.handler.ts";
import {
    fetchMcpServerList,
    fetchMcpServerDetail,
    type McpServerListItem,
    type McpServerDetail,
} from "../../cli/handlers/mcp.handler.ts";
import {
    fetchPluginList,
    fetchPluginDetail,
    validatePluginList,
    type PluginListItem,
    type PluginDetail,
    type PluginValidationView,
} from "../../cli/handlers/plugins.handler.ts";
import { fetchSandboxData, type SandboxData } from "../../cli/handlers/sandbox.handler.ts";
import {
    fetchBlackboardTurnList,
    fetchBlackboardTurnDetail,
    type BlackboardTurnItem,
    type BlackboardTurnDetail,
} from "../../cli/handlers/blackboard.handler.ts";
import { fetchMemoryData, type MemoryData } from "../../cli/handlers/memory.handler.ts";
import { fetchDreamData, runDreamPass, type DreamData } from "../../cli/handlers/dream.handler.ts";

// ── 颜色 ──────────────────────────────────────────────────

const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
    white: "\x1b[37m",
} as const;

// ── 页面路由 ──────────────────────────────────────────────

const PAGES = [
    "overview", "config", "skills", "mcp", "plugins",
    "sandbox", "blackboard", "memory", "dream",
] as const;
type PageId = (typeof PAGES)[number];

interface PageState {
    selectedIdx: number;
    mode: "list" | "detail" | "validation";
    activeTab: number;
}

// ── 入口 ──────────────────────────────────────────────────

export async function startCliTui(app: FlyFlor): Promise<void> {
    const screen = new Screen();
    const config: FlyflorConfig = app.resolve(FlyFlorTokens.Config);

    let pageIdx = 0;
    let pageState: PageState = { selectedIdx: 0, mode: "list", activeTab: 0 };
    let dirty = true;

    // ── 数据缓存 ────────────────────────────────────────
    type PageData =
        | { kind: "overview"; data: OverviewData }
        | { kind: "config"; data: ConfigData; configPath: string }
        | { kind: "skills"; items: SkillListItem[]; detail?: SkillDetail; validation?: SkillValidationView[] }
        | { kind: "mcp"; items: McpServerListItem[]; detail?: McpServerDetail }
        | { kind: "plugins"; items: PluginListItem[]; detail?: PluginDetail; validation?: PluginValidationView[] }
        | { kind: "sandbox"; data: SandboxData }
        | { kind: "blackboard"; items: BlackboardTurnItem[]; detail?: BlackboardTurnDetail }
        | { kind: "memory"; data: MemoryData }
        | { kind: "dream"; data: DreamData; lastRun?: Record<string, number> };

    let cache: Record<string, PageData> = {};

    async function loadPage(page: PageId): Promise<void> {
        switch (page) {
            case "overview":
                cache[page] = { kind: "overview", data: await fetchOverviewData(app) };
                break;
            case "config":
                cache[page] = { kind: "config", data: fetchConfigData(app, getFlyflorConfigPath()), configPath: getFlyflorConfigPath() };
                break;
            case "skills": {
                const items = await fetchSkillList(config.paths);
                cache[page] = { kind: "skills", items };
                break;
            }
            case "mcp": {
                const items = await fetchMcpServerList(config.paths);
                cache[page] = { kind: "mcp", items };
                break;
            }
            case "plugins": {
                const items = await fetchPluginList(config.paths);
                cache[page] = { kind: "plugins", items };
                break;
            }
            case "sandbox":
                cache[page] = { kind: "sandbox", data: await fetchSandboxData(config.paths) };
                break;
            case "blackboard": {
                const items = await fetchBlackboardTurnList(app, 20);
                cache[page] = { kind: "blackboard", items };
                break;
            }
            case "memory":
                cache[page] = { kind: "memory", data: await fetchMemoryData(app) };
                break;
            case "dream": {
                const data = fetchDreamData(app);
                cache[page] = { kind: "dream", data };
                break;
            }
        }
    }

    // ── 渲染 ──────────────────────────────────────────────

    function render(): void {
        const { rows, cols } = screen.getSize();
        const page = PAGES[pageIdx] ?? "overview";
        const pd = cache[page];
        const navWidth = 14;
        const contentWidth = cols - navWidth - 1;

        screen.clearRange(0, rows);

        // 顶栏
        const label = page[0]!.toUpperCase() + page.slice(1);
        screen.writeLine(0, { text: `╔${"═".repeat(cols - 2)}╗`, color: "#6FE7FF" });
        screen.writeLine(1, { text: `║ ${label.padEnd(cols - 4)} ║`, color: "#6FE7FF", bold: true });
        screen.writeLine(2, { text: `╚${"═".repeat(cols - 2)}╝`, color: "#6FE7FF" });

        // 左侧导航
        for (let i = 0; i < PAGES.length; i += 1) {
            const p = PAGES[i];
            if (!p) continue;
            const isActive = i === pageIdx;
            const sym = isActive ? "›" : " ";
            const text = `${sym} ${p.padEnd(navWidth - 4)}`;
            screen.writeLine(4 + i, { text, color: isActive ? "#6FE7FF" : "#98A3C7", bold: isActive, dim: !isActive });
        }

        // 右侧内容
        if (pd) {
            const lines = renderPage(pd, contentWidth, pageState);
            for (let i = 0; i < lines.length && 4 + i < rows; i += 1) {
                const line = lines[i];
                if (!line) continue;
                screen.writeLine(4 + i, { text: line }, navWidth);
            }
        } else {
            screen.writeLine(4, { text: "Loading…", color: "#98A3C7", dim: true }, navWidth);
        }

        // 底栏
        const hints = "h/l nav · j/k move · Enter detail · Esc back · r refresh · q quit";
        const hintRow = rows - 1;
        screen.writeLine(hintRow, {
            text: `─`.repeat(cols),
            color: "#6FE7FF",
            dim: true,
        });
        screen.writeLine(hintRow, {
            text: ` ${hints.padEnd(cols - 2)} `,
            color: "#98A3C7",
            dim: true,
        });

        screen.flush();
    }

    // ── 键盘处理 ──────────────────────────────────────────

    function page(): PageId { return PAGES[pageIdx] ?? "overview"; }

    const keyHandler = (key: KeyEvent): void => {
        const p = page();

        if (key.name === "q" || key.name === "escape") {
            if (pageState.mode !== "list") {
                pageState.mode = "list";
                pageState.selectedIdx = 0;
                dirty = true;
                return;
            }
            screen.close();
            return;
        }

        if (key.name === "r") {
            cache[p] = undefined!;
            loadPage(p).then(() => { dirty = true; });
            return;
        }

        // 页面导航
        if (key.name === "h" || (key.name === "tab" && key.shift)) {
            pageIdx = (pageIdx - 1 + PAGES.length) % PAGES.length;
            pageState = { selectedIdx: 0, mode: "list", activeTab: 0 };
            dirty = true;
            if (!cache[p]) loadPage(page()).then(() => { dirty = true; });
            return;
        }
        if (key.name === "l" || key.name === "tab") {
            pageIdx = (pageIdx + 1) % PAGES.length;
            pageState = { selectedIdx: 0, mode: "list", activeTab: 0 };
            dirty = true;
            if (!cache[p]) loadPage(page()).then(() => { dirty = true; });
            return;
        }

        // 列表中上下移动
        if (pageState.mode === "list") {
            const items = listItems(pd);
            if (key.name === "j" || key.name === "down") {
                pageState.selectedIdx = Math.min(pageState.selectedIdx + 1, items - 1);
                dirty = true;
                return;
            }
            if (key.name === "k" || key.name === "up") {
                pageState.selectedIdx = Math.max(0, pageState.selectedIdx - 1);
                dirty = true;
                return;
            }
        }

        // Enter 进入详情
        if (key.name === "return" && pageState.mode === "list") {
            enterDetail(p);
            dirty = true;
            return;
        }

        // Tab 切换详情页签（blackboard only）
        if (key.name === "tab" && pageState.mode === "detail") {
            pageState.activeTab = (pageState.activeTab + 1) % 3;
            dirty = true;
        }
    };

    function listItems(pd: PageData | undefined): number {
        if (!pd) return 0;
        switch (pd.kind) {
            case "overview": return pd.data.channels.length;
            case "skills": return pd.items.length;
            case "mcp": return pd.items.length;
            case "plugins": return pd.items.length;
            case "blackboard": return pd.items.length;
            default: return 0;
        }
    }

    async function enterDetail(pageId: PageId): Promise<void> {
        const pd = cache[pageId];
        if (!pd) return;
        switch (pd.kind) {
            case "skills": {
                const item = pd.items[pageState.selectedIdx];
                if (item) {
                    pageState.mode = "detail";
                    pd.detail = await fetchSkillDetail(config.paths, item.name);
                }
                break;
            }
            case "mcp": {
                const item = pd.items[pageState.selectedIdx];
                if (item) {
                    pageState.mode = "detail";
                    pd.detail = await fetchMcpServerDetail(config.paths, item.name);
                }
                break;
            }
            case "plugins": {
                const item = pd.items[pageState.selectedIdx];
                if (item) {
                    pageState.mode = "detail";
                    pd.detail = await fetchPluginDetail(config.paths, item.name);
                }
                break;
            }
            case "blackboard": {
                const item = pd.items[pageState.selectedIdx];
                if (item) {
                    pageState.mode = "detail";
                    pd.detail = await fetchBlackboardTurnDetail(app, item.turnId);
                }
                break;
            }
        }
    }

    function pd(): PageData | undefined { return cache[page()]; }

    // ── 启动 ──────────────────────────────────────────────

    screen.init();
    screen.onKey(keyHandler);

    // 首屏加载
    const initial = page();
    await loadPage(initial);
    dirty = true;

    let lastChecksum = -1;
    const checkLoop = setInterval(() => {
        const cs = pageIdx * 10000 + pageState.selectedIdx * 100 + (pageState.mode === "list" ? 0 : 1);
        if (cs !== lastChecksum || dirty) {
            lastChecksum = cs;
            dirty = false;
            render();
        }
    }, 33);

    screen.onResize(() => { dirty = true; });
    screen.onClose(() => clearInterval(checkLoop));

    await new Promise<void>((resolve) => screen.onClose(resolve));
}

// ── 页面渲染 ──────────────────────────────────────────────

function fmt(v: unknown): string { return String(v ?? ""); }

function kv(label: string, value: string, ok = false): string {
    const l = label.padEnd(20);
    const v = ok ? `${C.green}${value}${C.reset}` : value;
    return `  ${C.gray}${l}${C.reset} ${v}`;
}

function section(title: string): string {
    return `${C.bold}${C.cyan}◆ ${title}${C.reset}`;
}

function badge(text: string, color: string): string {
    return `${color}[${text}]${C.reset}`;
}

function selected(idx: number, sel: number): string {
    return idx === sel ? `${C.cyan}›${C.reset}` : " ";
}

function renderPage(pd: PageData, width: number, ps: PageState): string[] {
    switch (pd.kind) {
        case "overview": return renderOverview(pd.data, width, ps);
        case "config": return renderConfig(pd.data, pd.configPath, width);
        case "skills": return renderSkillList(pd.items, width, ps);
        case "mcp": return renderMcpList(pd.items, width, ps);
        case "plugins": return renderPluginList(pd.items, width, ps);
        case "sandbox": return renderSandbox(pd.data, width);
        case "blackboard": return renderBlackboard(pd.items, width, ps);
        case "memory": return renderMemory(pd.data, width);
        case "dream": return renderDream(pd.data, width);
    }
}

// ── Overview ──────────────────────────────────────────────

function renderOverview(data: OverviewData, w: number, ps: PageState): string[] {
    const l: string[] = [];
    l.push(section("Runtime"));
    l.push(kv("Model", data.runtime.model, true));
    l.push(kv("API mode", data.runtime.apiMode));
    l.push(kv("Sandbox", data.runtime.sandbox));
    l.push(kv("Config", data.runtime.configPath));
    l.push("");
    l.push(section("Gateway"));
    l.push(`  ${badge(data.gateway.running ? "running" : "stopped", data.gateway.running ? C.green : C.yellow)} ${badge(`${data.gateway.connectedCount}/${data.gateway.totalCount}`, C.gray)}`);
    l.push(kv("URL", data.gateway.url));
    l.push("");
    l.push(section("Channels  (" + data.channels.filter(c => c.connected).length + "/" + data.channels.length + " connected)"));
    for (let i = 0; i < data.channels.length; i += 1) {
        const ch = data.channels[i];
        if (!ch) continue;
        const sel = selected(i, ps.selectedIdx);
        const state = ch.state;
        const sc = state === "connected" ? C.green : state === "degraded" ? C.red : C.yellow;
        l.push(` ${sel} ${sc}●${C.reset} ${ch.name.padEnd(14)} ${C.gray}${ch.transport.padEnd(12)}${C.reset} ${sc}${state}${C.reset}`);
    }
    l.push("");
    l.push(section("Doctor  (" + data.doctor.filter(d => d.status === "ok").length + "/" + data.doctor.length + " ok)"));
    for (const d of data.doctor) {
        const sym = d.status === "ok" ? "✓" : d.status === "warn" ? "△" : "✗";
        const sc = d.status === "ok" ? C.green : d.status === "warn" ? C.yellow : C.red;
        l.push(`  ${sc}${sym}${C.reset} ${d.name.padEnd(22)} ${C.gray}${d.detail}${C.reset}`);
    }
    return l;
}

// ── Config ────────────────────────────────────────────────

function renderConfig(data: ConfigData, configPath: string, w: number): string[] {
    const l: string[] = [];
    l.push(section("Model"));
    l.push(kv("Provider", data.model.provider));
    l.push(kv("Model", data.model.model));
    l.push(kv("API mode", data.model.apiMode));
    l.push(kv("Kind", data.model.providerKind));
    if (data.model.baseUrl) l.push(kv("Base URL", data.model.baseUrl));
    l.push("");
    l.push(section("Gateway"));
    l.push(kv("Host", data.gateway.host));
    l.push(kv("Port", String(data.gateway.port)));
    l.push(kv("Channels", String(data.gateway.channelCount) + " configured"));
    l.push("");
    l.push(section("Sandbox"));
    l.push(kv("Mode", data.sandbox.mode));
    l.push(kv("MCP tool", data.sandbox.mcpToolApproval));
    l.push(kv("Shell hook", data.sandbox.shellHookApproval));
    l.push(kv("Plugin", data.sandbox.pluginApproval));
    l.push("");
    l.push(section("Memory"));
    l.push(kv("Journal", data.memory.enabled ? "enabled" : "disabled"));
    l.push(kv("Crystal", data.memory.crystalEnabled ? "enabled" : "disabled"));
    l.push(kv("Redis", data.memory.redisEnabled ? "enabled" : "disabled"));
    l.push(kv("Embedding", data.memory.embeddingDimensions + "d"));
    l.push("");
    l.push(section("Paths"));
    l.push(kv("Config", configPath));
    l.push(kv("Home", data.paths.home));
    l.push("");
    l.push(`${C.gray}e — Open config in system editor · r — Refresh${C.reset}`);
    return l;
}

// ── Skills / MCP / Plugins 列表 ───────────────────────────

function renderSkillList(items: SkillListItem[], w: number, ps: PageState): string[] {
    if (ps.mode === "detail") {
        const d = (cache["skills"] as { detail?: SkillDetail })?.detail;
        return d ? [section("Skill: " + d.name), "", kv("Source", d.source), kv("Version", d.version ?? "—"), "", `  ${C.gray}${d.description ?? "—"}${C.reset}`, "", `  ${C.gray}${d.path}${C.reset}`] : [];
    }
    if (ps.mode === "validation") {
        const v = (cache["skills"] as { validation?: SkillValidationView[] })?.validation;
        if (!v) return [];
        const ok = v.filter(r => r.ok).length;
        const l: string[] = [section("Validation  " + ok + "/" + v.length + " ok")];
        for (const r of v) {
            l.push(`  ${r.ok ? C.green + "✓" : C.red + "✗"}${C.reset} ${r.name.padEnd(16)} ${r.issues.length > 0 ? C.red + r.issues.join("; ") : C.gray + "ok"}${C.reset}`);
        }
        return l;
    }
    const l: string[] = [section("Skills  (" + items.length + " installed)")];
    if (items.length === 0) { l.push(`  ${C.gray}No skills installed.${C.reset}`); return l; }
    for (let i = 0; i < items.length; i += 1) {
        const s = items[i]; if (!s) continue;
        l.push(` ${selected(i, ps.selectedIdx)} ${s.name.padEnd(16)} ${C.gray}${(s.version ?? "—").padEnd(10)} ${s.source.padEnd(12)}${C.reset} ${C.gray}${(s.description ?? "—").slice(0, 40)}${C.reset}`);
    }
    return l;
}

function renderMcpList(items: McpServerListItem[], w: number, ps: PageState): string[] {
    if (ps.mode === "detail") {
        const d = (cache["mcp"] as { detail?: McpServerDetail })?.detail;
        if (!d) return [];
        const l: string[] = [section("MCP: " + d.name)];
        l.push(`  ${badge(d.transport, C.gray)} ${badge(d.enabled ? "enabled" : "disabled", d.enabled ? C.green : C.yellow)} ${badge(d.source, C.gray)}`);
        if (d.command) l.push(kv("command", d.command));
        if (d.url) l.push(kv("url", d.url));
        if (d.args.length) l.push(kv("args", d.args.join(" ")));
        l.push("");
        l.push(section("Tools (" + d.tools.length + ")"));
        for (const t of d.tools) {
            l.push(`  ${C.gray}•${C.reset} ${t.name.padEnd(24)} ${C.gray}${(t.description ?? "—").slice(0, 40)}${C.reset}`);
        }
        return l;
    }
    const l: string[] = [section("MCP Servers  (" + items.length + " configured)")];
    if (items.length === 0) { l.push(`  ${C.gray}No MCP servers configured.${C.reset}`); return l; }
    for (let i = 0; i < items.length; i += 1) {
        const s = items[i]; if (!s) continue;
        l.push(` ${selected(i, ps.selectedIdx)} ${s.enabled ? C.green + "●" : C.gray + "◌"}${C.reset} ${s.name.padEnd(16)} ${C.gray}${s.transport.padEnd(12)} ${s.source.padEnd(12)}${C.reset} ${C.gray}${(s.command || s.url || "—").slice(0, 30)}${C.reset} ${C.cyan}${s.toolCount}t${C.reset}`);
    }
    return l;
}

function renderPluginList(items: PluginListItem[], w: number, ps: PageState): string[] {
    if (ps.mode === "detail") {
        const d = (cache["plugins"] as { detail?: PluginDetail })?.detail;
        if (!d) return [];
        const l: string[] = [section("Plugin: " + d.name)];
        l.push(`  ${badge(d.enabled ? "enabled" : "disabled", d.enabled ? C.green : C.yellow)} ${badge(d.source, C.gray)}`);
        if (d.description) l.push(`  ${C.gray}${d.description}${C.reset}`);
        l.push(`  ${C.gray}${d.entry}${C.reset}`);
        return l;
    }
    if (ps.mode === "validation") {
        const v = (cache["plugins"] as { validation?: PluginValidationView[] })?.validation;
        if (!v) return [];
        const ok = v.filter(r => r.ok).length;
        const l: string[] = [section("Validation  " + ok + "/" + v.length + " ok")];
        for (const r of v) {
            l.push(`  ${r.ok ? C.green + "✓" : C.red + "✗"}${C.reset} ${r.name.padEnd(16)} ${r.issues.length > 0 ? C.red + r.issues.join("; ") : C.gray + "ok"}${C.reset}`);
        }
        return l;
    }
    const l: string[] = [section("Plugins  (" + items.length + ")")];
    if (items.length === 0) { l.push(`  ${C.gray}No plugins configured.${C.reset}`); return l; }
    for (let i = 0; i < items.length; i += 1) {
        const p = items[i]; if (!p) continue;
        l.push(` ${selected(i, ps.selectedIdx)} ${p.enabled ? C.green + "●" : C.gray + "◌"}${C.reset} ${p.name.padEnd(16)} ${C.gray}${p.source.padEnd(12)}${C.reset} ${C.gray}${(p.entry ?? "—").slice(0, 40)}${C.reset}`);
    }
    return l;
}

// ── Sandbox ───────────────────────────────────────────────

function renderSandbox(data: SandboxData, w: number): string[] {
    const l: string[] = [];
    for (const group of [
        { title: "Plugin Commands", entries: data.pluginCommands },
        { title: "Shell Commands", entries: data.shellCommands },
        { title: "MCP Tools", entries: data.mcpTools },
    ]) {
        l.push(section(group.title + "  (" + group.entries.length + ")"));
        if (group.entries.length === 0) {
            l.push(`  ${C.gray}No entries.${C.reset}`);
        } else {
            for (const e of group.entries) {
                l.push(`  ${C.green}✓${C.reset} ${e.value.padEnd(40)} ${C.gray}${e.source}${C.reset}`);
            }
        }
        l.push("");
    }
    return l;
}

// ── Blackboard ────────────────────────────────────────────

function renderBlackboard(items: BlackboardTurnItem[], w: number, ps: PageState): string[] {
    if (ps.mode === "detail") {
        const d = (cache["blackboard"] as { detail?: BlackboardTurnDetail })?.detail;
        if (!d) return [];
        const l: string[] = [section("Turn: " + d.goal.slice(0, 50))];
        l.push(kv("Status", d.status));
        l.push(kv("Workers", d.workers.length + " registered"));
        l.push(kv("Steps", String(d.steps.length)));
        l.push("");
        l.push(section("Workers"));
        for (const w of d.workers) {
            l.push(`  ${C.gray}•${C.reset} ${w.role.padEnd(16)} ${C.gray}${w.name ?? ""}${C.reset}`);
        }
        l.push("");
        l.push(section("Steps"));
        for (const s of d.steps.slice(-8)) {
            const oc = s.outcome === "final" ? C.green : s.outcome === "blocked" ? C.red : C.yellow;
            l.push(`  ${oc}●${C.reset} ${s.workerName.padEnd(14)} ${C.gray}${s.outcome}${C.reset}`);
        }
        return l;
    }
    const l: string[] = [section("Blackboard Turns  (" + items.length + ")")];
    if (items.length === 0) { l.push(`  ${C.gray}No blackboard turns yet.${C.reset}`); return l; }
    for (let i = 0; i < items.length; i += 1) {
        const t = items[i]; if (!t) continue;
        const sc = t.status === "converged" ? C.green : t.status === "needs-user" ? C.yellow : C.red;
        l.push(` ${selected(i, ps.selectedIdx)} ${sc}${t.status.padEnd(14)}${C.reset} ${t.goal.slice(0, 28).padEnd(28)} ${C.gray}${String(t.stepCount).padEnd(2)}s ${String(t.workerCount).padEnd(2)}w${C.reset} ${C.gray}${t.updatedAt ?? ""}${C.reset}`);
    }
    return l;
}

// ── Memory / Dream ────────────────────────────────────────

function renderMemory(data: MemoryData, w: number): string[] {
    const l: string[] = [];
    l.push(section("Memory Layers"));
    l.push(kv("Journal", data.enabled ? "enabled" : "disabled"));
    l.push(kv("Crystal", data.crystalEnabled ? "enabled" : "disabled"));
    l.push(kv("Redis", data.redisEnabled ? "enabled" : "disabled"));
    l.push(kv("SurrealDB", data.surrealEnabled ? "enabled" : "disabled"));
    l.push(kv("SQLite", data.sqliteEnabled ? "enabled" : "disabled"));
    l.push(kv("Embedding", data.embeddingDimensions + "d"));
    l.push("");
    l.push(section("Paths"));
    l.push(kv("Storage", data.storageDir));
    l.push(kv("Memory", data.memoryDir));
    return l;
}

function renderDream(data: DreamData, w: number): string[] {
    const l: string[] = [];
    l.push(section("Dream Stage"));
    l.push(`  ${badge(data.enabled ? "enabled" : "disabled", data.enabled ? C.green : C.yellow)} ${badge(data.busy ? "busy" : "idle", data.busy ? C.cyan : C.gray)} ${badge(data.users + " users", C.gray)}`);
    l.push(kv("Status", data.busy ? "Running…" : "Idle"));
    l.push(kv("Tracked users", String(data.users)));
    const lr = (cache["dream"] as { lastRun?: Record<string, number> })?.lastRun;
    if (lr) {
        l.push("");
        l.push(section("Last Run"));
        l.push(kv("Users", String(lr.users ?? 0)));
        l.push(kv("Drift repaired", String(lr.drift ?? 0)));
        l.push(kv("Recall reinforced", String(lr.recall ?? 0)));
        l.push(kv("Contradictions", String(lr.contradiction ?? 0)));
        l.push(kv("Skipped", String(lr.skipped ?? 0)));
    }
    return l;
}

// 全局 cache 引用（用于 detail 模式中读取跨页面数据）
let cache: Record<string, unknown> = {};

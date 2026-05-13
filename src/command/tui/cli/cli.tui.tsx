import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, useStdin } from "ink";
import { FlyFlorTokens, type FlyFlor } from "../../../app.ts";
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
import { fetchMcpServerList, fetchMcpServerDetail, type McpServerListItem, type McpServerDetail } from "../../cli/handlers/mcp.handler.ts";
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
import { fetchGhostList, type GhostListData } from "../../cli/handlers/ghost.list.handler.ts";
import { fetchDreamData, runDreamPass, type DreamData } from "../../cli/handlers/dream.handler.ts";
import { Shell, type CliPage } from "./shell.tsx";
import { OverviewPage } from "./pages/overview.page.tsx";
import { ConfigPage } from "./pages/config.page.tsx";
import { SkillsPage } from "./pages/skills.page.tsx";
import { McpPage } from "./pages/mcp.page.tsx";
import { PluginsPage } from "./pages/plugins.page.tsx";
import { SandboxPage } from "./pages/sandbox.page.tsx";
import { BlackboardPage } from "./pages/blackboard.page.tsx";
import { MemoryPage } from "./pages/memory.page.tsx";
import { GhostsPage } from "./pages/ghosts.page.tsx";
import { DreamPage } from "./pages/dream.page.tsx";

interface CliTuiProps {
    app: FlyFlor;
    initialPage: CliPage;
}

type PageMode = "list" | "detail" | "validation";

function CliTui({ app, initialPage }: CliTuiProps): React.ReactElement {
    const inkApp = useApp();
    const { setRawMode } = useStdin();
    const [activePage, setActivePage] = useState<CliPage>(initialPage);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [loadedPages, setLoadedPages] = useState<Set<CliPage>>(new Set());

    // Overview state
    const [overviewData, setOverviewData] = useState<OverviewData | undefined>();
    const [selectedChannel, setSelectedChannel] = useState(0);

    // Config state
    const [configData, setConfigData] = useState<ConfigData | undefined>();

    // Skills state
    const [skillItems, setSkillItems] = useState<SkillListItem[]>([]);
    const [selectedSkill, setSelectedSkill] = useState(0);
    const [skillDetail, setSkillDetail] = useState<SkillDetail | undefined>();
    const [skillValidation, setSkillValidation] = useState<SkillValidationView[] | undefined>();
    const [skillMode, setSkillMode] = useState<PageMode>("list");

    // MCP state
    const [mcpItems, setMcpItems] = useState<McpServerListItem[]>([]);
    const [selectedMcp, setSelectedMcp] = useState(0);
    const [mcpDetail, setMcpDetail] = useState<McpServerDetail | undefined>();
    const [mcpMode, setMcpMode] = useState<PageMode>("list");

    // Plugins state
    const [pluginItems, setPluginItems] = useState<PluginListItem[]>([]);
    const [selectedPlugin, setSelectedPlugin] = useState(0);
    const [pluginDetail, setPluginDetail] = useState<PluginDetail | undefined>();
    const [pluginValidation, setPluginValidation] = useState<PluginValidationView[] | undefined>();
    const [pluginMode, setPluginMode] = useState<PageMode>("list");

    // Sandbox state
    const [sandboxData, setSandboxData] = useState<SandboxData | undefined>();

    // Blackboard state
    const [blackboardItems, setBlackboardItems] = useState<BlackboardTurnItem[]>([]);
    const [selectedBlackboard, setSelectedBlackboard] = useState(0);
    const [blackboardDetail, setBlackboardDetail] = useState<BlackboardTurnDetail | undefined>();
    const [blackboardMode, setBlackboardMode] = useState<PageMode>("list");
    const [blackboardTab, setBlackboardTab] = useState(0);

    // Memory state
    const [memoryData, setMemoryData] = useState<MemoryData | undefined>();
    const [ghostData, setGhostData] = useState<GhostListData | undefined>();

    // Dream state
    const [dreamData, setDreamData] = useState<DreamData | undefined>();
    const [lastDreamRun, setLastDreamRun] = useState<{ users: number; drift: number; recall: number; contradiction: number; skipped: number } | undefined>();
    const [dreamRunning, setDreamRunning] = useState(false);

    const refresh = async (force = false) => {
        if (!force && loadedPages.has(activePage)) {
            return;
        }
        setIsLoading(true);
        setError(undefined);
        try {
            switch (activePage) {
                case "overview": {
                    const data = await fetchOverviewData(app);
                    setOverviewData(data);
                    setSelectedChannel((prev) => Math.min(prev, Math.max(0, data.channels.length - 1)));
                    break;
                }
                case "config": {
                    const data = fetchConfigData(app, getFlyflorConfigPath());
                    setConfigData(data);
                    break;
                }
                case "skills": {
                    const config = app.resolve(FlyFlorTokens.Config);
                    const items = await fetchSkillList(config.paths);
                    setSkillItems(items);
                    setSelectedSkill((prev) => Math.min(prev, Math.max(0, items.length - 1)));
                    setSkillMode("list");
                    setSkillDetail(undefined);
                    setSkillValidation(undefined);
                    break;
                }
                case "mcp": {
                    const config = app.resolve(FlyFlorTokens.Config);
                    const items = await fetchMcpServerList(config.paths);
                    setMcpItems(items);
                    setSelectedMcp((prev) => Math.min(prev, Math.max(0, items.length - 1)));
                    setMcpMode("list");
                    setMcpDetail(undefined);
                    break;
                }
                case "plugins": {
                    const config = app.resolve(FlyFlorTokens.Config);
                    const items = await fetchPluginList(config.paths);
                    setPluginItems(items);
                    setSelectedPlugin((prev) => Math.min(prev, Math.max(0, items.length - 1)));
                    setPluginMode("list");
                    setPluginDetail(undefined);
                    setPluginValidation(undefined);
                    break;
                }
                case "sandbox": {
                    const config = app.resolve(FlyFlorTokens.Config);
                    const data = await fetchSandboxData(config.paths);
                    setSandboxData(data);
                    break;
                }
                case "blackboard": {
                    const items = await fetchBlackboardTurnList(app, 20);
                    setBlackboardItems(items);
                    setSelectedBlackboard((prev) => Math.min(prev, Math.max(0, items.length - 1)));
                    setBlackboardMode("list");
                    setBlackboardDetail(undefined);
                    break;
                }
                case "memory": {
                    const data = await fetchMemoryData(app);
                    setMemoryData(data);
                    break;
                }
                case "ghosts": {
                    const data = await fetchGhostList(app, "human", 60);
                    setGhostData(data);
                    break;
                }
                case "dream": {
                    const data = fetchDreamData(app);
                    setDreamData(data);
                    break;
                }
                default:
                    break;
            }
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setIsLoading(false);
            setLoadedPages((prev) => new Set(prev).add(activePage));
        }
    };

    useEffect(() => {
        void refresh(false);
    }, [activePage]);

    useInput((input, key) => {
        if (key.escape || input === "q") {
            inkApp.exit();
            return;
        }

        // Global nav: Tab/Shift+Tab switch pages; h/l reserved for in-page horizontal nav
        if (key.tab) {
            const delta = key.shift ? -1 : 1;
            setActivePage((current) => cyclePage(current, delta));
            return;
        }

        if (input === "r") {
            void refresh(true);
            return;
        }

        // Page-specific keyboard handling
        if (activePage === "overview") {
            const count = overviewData?.channels.length ?? 0;
            if (key.upArrow || input === "k") {
                setSelectedChannel((prev) => Math.max(0, prev - 1));
                return;
            }
            if (key.downArrow || input === "j") {
                setSelectedChannel((prev) => Math.min(count - 1, prev + 1));
                return;
            }
        }

        if (activePage === "skills") {
            const count = skillItems.length;
            if (skillMode === "list") {
                if (key.upArrow || input === "k") {
                    setSelectedSkill((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (key.downArrow || input === "j") {
                    setSelectedSkill((prev) => Math.min(count - 1, prev + 1));
                    return;
                }
                if (key.return) {
                    const name = skillItems[selectedSkill]?.name;
                    if (name) {
                        void (async () => {
                            const config = app.resolve(FlyFlorTokens.Config);
                            const detail = await fetchSkillDetail(config.paths, name);
                            setSkillDetail(detail);
                            setSkillMode("detail");
                        })();
                    }
                    return;
                }
                if (input === "v") {
                    const name = skillItems[selectedSkill]?.name;
                    void (async () => {
                        const config = app.resolve(FlyFlorTokens.Config);
                        const results = await validateSkills(config.paths, name);
                        setSkillValidation(results);
                        setSkillMode("validation");
                    })();
                    return;
                }
            } else {
                if (key.escape || input === "b" || input === "q") {
                    setSkillMode("list");
                    setSkillDetail(undefined);
                    setSkillValidation(undefined);
                    return;
                }
            }
        }

        if (activePage === "mcp") {
            const count = mcpItems.length;
            if (mcpMode === "list") {
                if (key.upArrow || input === "k") {
                    setSelectedMcp((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (key.downArrow || input === "j") {
                    setSelectedMcp((prev) => Math.min(count - 1, prev + 1));
                    return;
                }
                if (key.return) {
                    const name = mcpItems[selectedMcp]?.name;
                    if (name) {
                        void (async () => {
                            const config = app.resolve(FlyFlorTokens.Config);
                            const detail = await fetchMcpServerDetail(config.paths, app, name);
                            setMcpDetail(detail);
                            setMcpMode("detail");
                        })();
                    }
                    return;
                }
            } else {
                if (key.escape || input === "b") {
                    setMcpMode("list");
                    setMcpDetail(undefined);
                    return;
                }
            }
        }

        if (activePage === "plugins") {
            const count = pluginItems.length;
            if (pluginMode === "list") {
                if (key.upArrow || input === "k") {
                    setSelectedPlugin((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (key.downArrow || input === "j") {
                    setSelectedPlugin((prev) => Math.min(count - 1, prev + 1));
                    return;
                }
                if (key.return) {
                    const name = pluginItems[selectedPlugin]?.name;
                    if (name) {
                        void (async () => {
                            const config = app.resolve(FlyFlorTokens.Config);
                            const detail = await fetchPluginDetail(config.paths, name);
                            setPluginDetail(detail);
                            setPluginMode("detail");
                        })();
                    }
                    return;
                }
                if (input === "v") {
                    void (async () => {
                        const config = app.resolve(FlyFlorTokens.Config);
                        const results = await validatePluginList(config.paths);
                        setPluginValidation(results);
                        setPluginMode("validation");
                    })();
                    return;
                }
            } else {
                if (key.escape || input === "b" || input === "q") {
                    setPluginMode("list");
                    setPluginDetail(undefined);
                    setPluginValidation(undefined);
                    return;
                }
            }
        }

        if (activePage === "blackboard") {
            const count = blackboardItems.length;
            if (blackboardMode === "list") {
                if (key.upArrow || input === "k") {
                    setSelectedBlackboard((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (key.downArrow || input === "j") {
                    setSelectedBlackboard((prev) => Math.min(count - 1, prev + 1));
                    return;
                }
                if (key.return) {
                    const turnId = blackboardItems[selectedBlackboard]?.id;
                    if (turnId) {
                        void (async () => {
                            const detail = await fetchBlackboardTurnDetail(app, turnId);
                            setBlackboardDetail(detail);
                            setBlackboardMode("detail");
                            setBlackboardTab(0);
                        })();
                    }
                    return;
                }
            } else {
                if (key.escape || input === "b") {
                    setBlackboardMode("list");
                    setBlackboardDetail(undefined);
                    return;
                }
                // Tab navigation inside detail view
                if (key.leftArrow || input === "h") {
                    setBlackboardTab((prev) => Math.max(0, prev - 1));
                    return;
                }
                if (key.rightArrow || input === "l") {
                    setBlackboardTab((prev) => Math.min(4, prev + 1));
                    return;
                }
                if (input >= "1" && input <= "5") {
                    setBlackboardTab(Number.parseInt(input, 10) - 1);
                    return;
                }
            }
        }

        if (activePage === "config" && input === "e") {
            void (async () => {
                const { spawn } = await import("node:child_process");
                const editor = process.env.EDITOR ?? "vi";
                setRawMode(false);
                const child = spawn(editor, [getFlyflorConfigPath()], { stdio: "inherit" });
                await new Promise<void>((resolve) => child.on("exit", resolve));
                setRawMode(true);
            })();
            return;
        }

        if (activePage === "dream" && input === "r" && !dreamRunning) {
            setDreamRunning(true);
            void (async () => {
                try {
                    const result = await runDreamPass(app);
                    setLastDreamRun({
                        users: result.users,
                        drift: result.driftRepaired,
                        recall: result.recallReinforced,
                        contradiction: result.contradictionsFlagged,
                        skipped: result.skipped,
                    });
                    const data = fetchDreamData(app);
                    setDreamData(data);
                } finally {
                    setDreamRunning(false);
                }
            })();
            return;
        }
    });

    const renderPage = () => {
        if (isLoading) {
            return (
                <Shell activePage={activePage} pageHints={["Loading..."]}>
                    <Placeholder text="Loading..." />
                </Shell>
            );
        }
        if (error) {
            return (
                <Shell activePage={activePage} pageHints={["r retry"]}>
                    <Placeholder text={`Error: ${error}`} color="red" />
                </Shell>
            );
        }

        switch (activePage) {
            case "overview":
                return (
                    <Shell activePage={activePage}>
                        {overviewData ? (
                            <OverviewPage data={overviewData} selectedChannelIndex={selectedChannel} />
                        ) : (
                            <Placeholder text="No data" />
                        )}
                    </Shell>
                );
            case "config":
                return (
                    <Shell activePage={activePage} pageHints={["e edit config"]}>
                        {configData ? <ConfigPage data={configData} /> : <Placeholder text="No config data" />}
                    </Shell>
                );
            case "skills":
                return (
                    <Shell activePage={activePage} pageHints={skillMode === "list" ? ["Enter detail", "v validate"] : ["b back"]}>
                        <SkillsPage
                            items={skillItems}
                            selectedIndex={selectedSkill}
                            detail={skillDetail}
                            validation={skillValidation}
                            mode={skillMode}
                        />
                    </Shell>
                );
            case "mcp":
                return (
                    <Shell activePage={activePage} pageHints={mcpMode === "list" ? ["Enter detail"] : ["b back"]}>
                        <McpPage
                            items={mcpItems}
                            selectedIndex={selectedMcp}
                            detail={mcpDetail}
                            mode={mcpMode === "list" ? "list" : "detail"}
                        />
                    </Shell>
                );
            case "plugins":
                return (
                    <Shell activePage={activePage} pageHints={pluginMode === "list" ? ["Enter detail", "v validate"] : ["b back"]}>
                        <PluginsPage
                            items={pluginItems}
                            selectedIndex={selectedPlugin}
                            detail={pluginDetail}
                            validation={pluginValidation}
                            mode={pluginMode}
                        />
                    </Shell>
                );
            case "sandbox":
                return (
                    <Shell activePage={activePage}>
                        {sandboxData ? <SandboxPage data={sandboxData} /> : <Placeholder text="No data" />}
                    </Shell>
                );
            case "blackboard":
                return (
                    <Shell activePage={activePage} pageHints={blackboardMode === "list" ? ["Enter detail"] : ["b back"]}>
                        <BlackboardPage
                            items={blackboardItems}
                            selectedIndex={selectedBlackboard}
                            detail={blackboardDetail}
                            mode={blackboardMode === "list" ? "list" : "detail"}
                            activeTab={blackboardTab}
                        />
                    </Shell>
                );
            case "memory":
                return (
                    <Shell activePage={activePage}>
                        {memoryData ? <MemoryPage data={memoryData} /> : <Placeholder text="No data" />}
                    </Shell>
                );
            case "ghosts":
                return (
                    <Shell activePage={activePage}>
                        <GhostsPage data={ghostData} />
                    </Shell>
                );
            case "dream":
                return (
                    <Shell activePage={activePage} pageHints={dreamRunning ? ["Running..."] : ["r run dream pass"]}>
                        {dreamData ? (
                            <DreamPage data={dreamData} lastRun={lastDreamRun} />
                        ) : (
                            <Placeholder text="No data" />
                        )}
                    </Shell>
                );
            default:
                return (
                    <Shell activePage={activePage} pageHints={["Coming soon"]}>
                        <Placeholder text={`${activePage} page — coming soon`} />
                    </Shell>
                );
        }
    };

    return renderPage();
}

function Placeholder({ text, color = "gray" }: { text: string; color?: string }): React.ReactElement {
    return (
        <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text color={color} dimColor>
                {text}
            </Text>
        </Box>
    );
}

export async function startCliTui(app: FlyFlor, initialPage: CliPage = "overview"): Promise<void> {
    const instance = render(<CliTui app={app} initialPage={initialPage} />);
    await instance.waitUntilExit();
}

function cyclePage(current: CliPage, delta: number): CliPage {
    const ids: CliPage[] = [
        "overview",
        "skills",
        "mcp",
        "plugins",
        "sandbox",
        "blackboard",
        "memory",
        "ghosts",
        "dream",
        "config",
    ];
    const index = ids.indexOf(current);
    const next = (index + delta + ids.length) % ids.length;
    return ids[next]!;
}

function errorMessage(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    return String(cause);
}

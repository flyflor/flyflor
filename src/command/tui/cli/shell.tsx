import React from "react";
import { Box, Text } from "ink";
import { TopBar, BottomHint } from "./components/layout.tsx";

export type CliPage = "overview" | "skills" | "mcp" | "plugins" | "sandbox" | "blackboard" | "memory" | "ghosts" | "dream" | "config";

export const CLI_PAGES: Array<{ id: CliPage; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "skills", label: "Skills" },
    { id: "mcp", label: "MCP" },
    { id: "plugins", label: "Plugins" },
    { id: "sandbox", label: "Sandbox" },
    { id: "blackboard", label: "Blackboard" },
    { id: "memory", label: "Memory" },
    { id: "ghosts", label: "Ghosts" },
    { id: "dream", label: "Dream" },
    { id: "config", label: "Config" },
];

interface ShellProps {
    activePage: CliPage;
    children: React.ReactNode;
    pageHints?: string[];
}

export function Shell({ activePage, children, pageHints }: ShellProps): React.ReactElement {
    const activeLabel = CLI_PAGES.find((p) => p.id === activePage)?.label ?? activePage;

    return (
        <Box flexDirection="column" height="100%" paddingX={1} paddingY={0} gap={1}>
            <TopBar title={activeLabel} />

            <Box flexDirection="row" gap={1} flexGrow={1} overflow="hidden">
                <LeftNav activePage={activePage} />
                <Box flexDirection="column" flexGrow={1} gap={1} overflow="hidden">
                    {children}
                </Box>
            </Box>

            <BottomHint
                hints={[
                    "h/l nav pages",
                    "j/k move",
                    "Enter detail",
                    "r refresh",
                    "q quit",
                    ...(pageHints ?? []),
                ]}
            />
        </Box>
    );
}

function LeftNav({ activePage }: { activePage: CliPage }): React.ReactElement {
    return (
        <Box flexDirection="column" width={14} gap={0}>
            {CLI_PAGES.map((page) => {
                const isActive = page.id === activePage;
                return (
                    <Box key={page.id} flexDirection="row">
                        <Text color={isActive ? "cyan" : "gray"} bold={isActive} dimColor={!isActive}>
                            {isActive ? "› " : "  "}
                            {page.label}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}

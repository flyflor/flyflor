import React from "react";
import { Box, Text } from "ink";
import type { SandboxData } from "../../../cli/handlers/sandbox.handler.ts";
import { SectionCard, KeyValueRow } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";

interface SandboxPageProps {
    data: SandboxData;
}

export function SandboxPage({ data }: SandboxPageProps): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <AllowlistCard title="Plugin Commands" entries={data.pluginCommands} />
            <AllowlistCard title="Shell Commands" entries={data.shellCommands} />
            <AllowlistCard title="MCP Tools" entries={data.mcpTools} />
        </Box>
    );
}

function AllowlistCard({
    title,
    entries,
}: {
    title: string;
    entries: Array<{ value: string; source: string }>;
}): React.ReactElement {
    return (
        <SectionCard title={`${title}  (${entries.length})`}>
            {entries.length === 0 ? (
                <Text color="gray" dimColor>
                    No entries.
                </Text>
            ) : (
                <Box flexDirection="column" gap={0}>
                    {entries.map((entry, index) => (
                        <Box key={index} flexDirection="row" gap={1}>
                            <Box width={3}>
                                <Text color="green">✓</Text>
                            </Box>
                            <Box width={40}>
                                <Text wrap="truncate">{entry.value}</Text>
                            </Box>
                            <Box width={10}>
                                <Text color="gray" dimColor>
                                    {entry.source}
                                </Text>
                            </Box>
                        </Box>
                    ))}
                </Box>
            )}
        </SectionCard>
    );
}

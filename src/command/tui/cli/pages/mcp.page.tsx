import React from "react";
import { Box, Text } from "ink";
import type { McpServerListItem, McpServerDetail } from "../../../cli/handlers/mcp.handler.ts";
import { SectionCard } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";
import { SelectableList, SelectableRow } from "../components/selectable.list.tsx";

interface McpPageProps {
    items: McpServerListItem[];
    selectedIndex: number;
    detail?: McpServerDetail;
    mode: "list" | "detail";
}

export function McpPage({ items, selectedIndex, detail, mode }: McpPageProps): React.ReactElement {
    if (mode === "detail" && detail) {
        return <McpDetailCard detail={detail} />;
    }
    return <McpListCard items={items} selectedIndex={selectedIndex} />;
}

function McpListCard({ items, selectedIndex }: { items: McpServerListItem[]; selectedIndex: number }): React.ReactElement {
    return (
        <SectionCard title={`MCP Servers  (${items.length} configured)`}>
            <SelectableList
                items={items}
                selectedIndex={selectedIndex}
                emptyMessage="No MCP servers configured."
                renderItem={(server, idx, selected) => (
                    <SelectableRow isSelected={selected} prefix="›">
                        <Box flexDirection="row" gap={1} width="100%">
                            <Box width={3}>
                                <Text color={server.enabled ? "green" : "gray"}>
                                    {server.enabled ? "●" : "◌"}
                                </Text>
                            </Box>
                            <Box width={16}>
                                <Text bold wrap="truncate">{server.name}</Text>
                            </Box>
                            <Box width={12}>
                                <Text color="gray" wrap="truncate">
                                    {server.transport}
                                </Text>
                            </Box>
                            <Box width={12}>
                                <Text color="gray" wrap="truncate">
                                    {server.source}
                                </Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {server.command || server.url || "—"}
                                </Text>
                            </Box>
                            <Box width={8}>
                                <Text color="cyan">{server.toolCount} tools</Text>
                            </Box>
                        </Box>
                    </SelectableRow>
                )}
            />
        </SectionCard>
    );
}

function McpDetailCard({ detail }: { detail: McpServerDetail }): React.ReactElement {
    return (
        <SectionCard title={`MCP: ${detail.name}`}>
            <Box flexDirection="column" gap={0}>
                <Box flexDirection="row" gap={1} marginBottom={1}>
                    <StatusBadge label={detail.transport} status="info" />
                    <StatusBadge label={detail.enabled ? "enabled" : "disabled"} status={detail.enabled ? "ok" : "warn"} />
                    <StatusBadge label={detail.source} status="idle" />
                </Box>
                {detail.command ? <Text color="gray">command: {detail.command}</Text> : null}
                {detail.url ? <Text color="gray">url: {detail.url}</Text> : null}
                {detail.args.length > 0 ? (
                    <Text color="gray">args: {detail.args.join(" ")}</Text>
                ) : null}
                {Object.keys(detail.env).length > 0 ? (
                    <Text color="gray">env: {Object.keys(detail.env).join(", ")}</Text>
                ) : null}
                <Box marginTop={1} marginBottom={1}>
                    <Text bold>Tools ({detail.tools.length}):</Text>
                </Box>
                <Box flexDirection="column" gap={0}>
                    {detail.tools.map((tool, index) => (
                        <Box key={index} flexDirection="row" gap={1}>
                            <Box width={3}>
                                <Text color="gray">•</Text>
                            </Box>
                            <Box width={24}>
                                <Text bold wrap="truncate">{tool.name}</Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {tool.description || "—"}
                                </Text>
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        </SectionCard>
    );
}

import React from "react";
import { Box, Text } from "ink";
import type { PluginListItem, PluginDetail, PluginValidationView } from "../../../cli/handlers/plugins.handler.ts";
import { SectionCard } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";
import { SelectableList, SelectableRow } from "../components/selectable.list.tsx";

interface PluginsPageProps {
    items: PluginListItem[];
    selectedIndex: number;
    detail?: PluginDetail;
    validation?: PluginValidationView[];
    mode: "list" | "detail" | "validation";
}

export function PluginsPage({ items, selectedIndex, detail, validation, mode }: PluginsPageProps): React.ReactElement {
    if (mode === "detail" && detail) {
        return <PluginDetailCard detail={detail} />;
    }
    if (mode === "validation" && validation) {
        return <PluginValidationCard results={validation} />;
    }
    return <PluginListCard items={items} selectedIndex={selectedIndex} />;
}

function PluginListCard({ items, selectedIndex }: { items: PluginListItem[]; selectedIndex: number }): React.ReactElement {
    return (
        <SectionCard title={`Plugins  (${items.length})`}>
            <SelectableList
                items={items}
                selectedIndex={selectedIndex}
                emptyMessage="No plugins configured."
                renderItem={(plugin, idx, selected) => (
                    <SelectableRow isSelected={selected} prefix="›">
                        <Box flexDirection="row" gap={1} width="100%">
                            <Box width={3}>
                                <Text color={plugin.enabled ? "green" : "gray"}>
                                    {plugin.enabled ? "●" : "◌"}
                                </Text>
                            </Box>
                            <Box width={16}>
                                <Text bold wrap="truncate">{plugin.name}</Text>
                            </Box>
                            <Box width={12}>
                                <Text color="gray" wrap="truncate">
                                    {plugin.source}
                                </Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {plugin.entry}
                                </Text>
                            </Box>
                        </Box>
                    </SelectableRow>
                )}
            />
        </SectionCard>
    );
}

function PluginDetailCard({ detail }: { detail: PluginDetail }): React.ReactElement {
    return (
        <SectionCard title={`Plugin: ${detail.name}`}>
            <Box flexDirection="column" gap={0}>
                <Box flexDirection="row" gap={1} marginBottom={1}>
                    <StatusBadge label={detail.enabled ? "enabled" : "disabled"} status={detail.enabled ? "ok" : "warn"} />
                    <StatusBadge label={detail.source} status="info" />
                </Box>
                <Text color="gray">{detail.description || "No description."}</Text>
                <Box marginTop={1}>
                    <Text color="gray" dimColor>
                        {detail.entry}
                    </Text>
                </Box>
            </Box>
        </SectionCard>
    );
}

function PluginValidationCard({ results }: { results: PluginValidationView[] }): React.ReactElement {
    const okCount = results.filter((r) => r.ok).length;
    return (
        <SectionCard title={`Validation  ${okCount}/${results.length} ok`}>
            <Box flexDirection="column" gap={0}>
                {results.map((result, index) => (
                    <Box key={index} flexDirection="row" gap={1}>
                        <Box width={3}>
                            <Text color={result.ok ? "green" : "red"}>{result.ok ? "✓" : "✗"}</Text>
                        </Box>
                        <Box width={16}>
                            <Text bold wrap="truncate">{result.name}</Text>
                        </Box>
                        <Box flexGrow={1}>
                            {result.issues.length > 0 ? (
                                <Text color="red" wrap="truncate">
                                    {result.issues.join("; ")}
                                </Text>
                            ) : (
                                <Text color="gray" dimColor>ok</Text>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

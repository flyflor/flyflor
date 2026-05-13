import React from "react";
import { Box, Text } from "ink";
import type { SkillListItem, SkillDetail, SkillValidationView } from "../../../cli/handlers/skills.handler.ts";
import { SectionCard } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";
import { SelectableList, SelectableRow } from "../components/selectable.list.tsx";

interface SkillsPageProps {
    items: SkillListItem[];
    selectedIndex: number;
    detail?: SkillDetail;
    validation?: SkillValidationView[];
    mode: "list" | "detail" | "validation";
}

export function SkillsPage({ items, selectedIndex, detail, validation, mode }: SkillsPageProps): React.ReactElement {
    if (mode === "detail" && detail) {
        return <SkillDetailCard detail={detail} />;
    }
    if (mode === "validation" && validation) {
        return <SkillValidationCard results={validation} />;
    }
    return <SkillListCard items={items} selectedIndex={selectedIndex} />;
}

function SkillListCard({ items, selectedIndex }: { items: SkillListItem[]; selectedIndex: number }): React.ReactElement {
    return (
        <SectionCard title={`Skills  (${items.length} installed)`}>
            <SelectableList
                items={items}
                selectedIndex={selectedIndex}
                emptyMessage="No skills installed."
                renderItem={(skill, idx, selected) => (
                    <SelectableRow isSelected={selected} prefix="›">
                        <Box flexDirection="row" gap={1} width="100%">
                            <Box width={16}>
                                <Text bold wrap="truncate">{skill.name}</Text>
                            </Box>
                            <Box width={10}>
                                <Text color="gray" wrap="truncate">
                                    {skill.version}
                                </Text>
                            </Box>
                            <Box width={12}>
                                <Text color="gray" wrap="truncate">
                                    {skill.source}
                                </Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {skill.description || "—"}
                                </Text>
                            </Box>
                        </Box>
                    </SelectableRow>
                )}
            />
        </SectionCard>
    );
}

function SkillDetailCard({ detail }: { detail: SkillDetail }): React.ReactElement {
    return (
        <SectionCard title={`Skill: ${detail.name}`}>
            <Box flexDirection="column" gap={0}>
                <Box flexDirection="row" gap={1} marginBottom={1}>
                    <StatusBadge label={detail.source} status="info" />
                    <StatusBadge label={detail.version || "—"} status="idle" />
                    <StatusBadge label={`schema v${detail.schemaVersion || "?"}`} status="idle" />
                </Box>
                <Text color="gray">{detail.description || "No description."}</Text>
                <Box marginTop={1}>
                    <Text color="gray" dimColor>
                        {detail.path}
                    </Text>
                </Box>
            </Box>
        </SectionCard>
    );
}

function SkillValidationCard({ results }: { results: SkillValidationView[] }): React.ReactElement {
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
                                <Text color="gray" dimColor>
                                    ok
                                </Text>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

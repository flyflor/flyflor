import React from "react";
import { Box, Text } from "ink";
import type { GhostGroup, GhostListData, GhostListItem } from "../../../cli/handlers/ghost.list.handler.ts";
import { SectionCard } from "../components/layout.tsx";

interface GhostsPageProps {
    data?: GhostListData;
}

export function GhostsPage({ data }: GhostsPageProps): React.ReactElement {
    if (!data) {
        return (
            <SectionCard title="Ghost Context">
                <Text color="gray">Loading…</Text>
            </SectionCard>
        );
    }
    if (!data.present) {
        return (
            <SectionCard title="Ghost Context">
                <Text color="gray">brain.db not found at {data.brainPath}.</Text>
            </SectionCard>
        );
    }
    if (data.total === 0) {
        return (
            <SectionCard title={`Ghost Context  (user: ${data.userId})`}>
                <Text color="gray">No active ghost-context entries.</Text>
            </SectionCard>
        );
    }
    return (
        <Box flexDirection="column" gap={1}>
            <SectionCard title={`Ghost Context  (user: ${data.userId}, total: ${data.total})`}>
                <Text color="gray">Active ghosts grouped by codename.</Text>
            </SectionCard>
            {data.groups.map((group) => (
                <GroupCard key={groupKey(group)} group={group} />
            ))}
        </Box>
    );
}

function groupKey(group: GhostGroup): string {
    return group.codenameId ?? "__none__";
}

function GroupCard({ group }: { group: GhostGroup }): React.ReactElement {
    return (
        <SectionCard title={`${group.label}  (${group.items.length})`}>
            <Box flexDirection="column">
                {group.items.map((item) => (
                    <GhostRow key={item.id} item={item} />
                ))}
            </Box>
        </SectionCard>
    );
}

function GhostRow({ item }: { item: GhostListItem }): React.ReactElement {
    const ts = new Date(item.ts).toISOString();
    return (
        <Box flexDirection="column" marginBottom={0}>
            <Box flexDirection="row" gap={1}>
                <Box width={18}>
                    <Text color={reasonColor(item.reason)} wrap="truncate">
                        {item.reason}
                    </Text>
                </Box>
                <Box flexGrow={1}>
                    <Text bold wrap="truncate">
                        {truncate(item.title, 60)}
                    </Text>
                </Box>
                <Box width={22}>
                    <Text color="gray" dimColor wrap="truncate">
                        {ts}
                    </Text>
                </Box>
            </Box>
            {item.contextHint ? (
                <Box paddingLeft={2}>
                    <Text color="gray" wrap="truncate">
                        {truncate(item.contextHint, 100)}
                    </Text>
                </Box>
            ) : null}
        </Box>
    );
}

function reasonColor(reason: string): string {
    switch (reason) {
        case "ask":
            return "cyan";
        case "tool-failure":
            return "red";
        case "blackboard-cap":
            return "yellow";
        case "process-restart":
            return "magenta";
        default:
            return "white";
    }
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

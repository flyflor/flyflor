import React from "react";
import { Box, Text } from "ink";
import type { MemoryData } from "../../../cli/handlers/memory.handler.ts";
import { SectionCard, KeyValueRow } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";

interface MemoryPageProps {
    data: MemoryData;
}

export function MemoryPage({ data }: MemoryPageProps): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
                <Box flexDirection="column" gap={1} width="50%">
                    <SectionCard title="Memory Layers">
                        <Box flexDirection="row" gap={1} marginBottom={1}>
                            <StatusBadge label="journal" status={data.enabled ? "ok" : "warn"} />
                            <StatusBadge label="crystal" status={data.crystalEnabled ? "ok" : "warn"} />
                        </Box>
                        <KeyValueRow label="Redis" value={data.redisEnabled ? "enabled" : "disabled"} />
                        <KeyValueRow label="SurrealDB" value={data.surrealEnabled ? "enabled" : "disabled"} />
                        <KeyValueRow label="SQLite" value={data.sqliteEnabled ? "enabled" : "disabled"} />
                        <KeyValueRow label="Embedding" value={`${data.embeddingDimensions}d`} />
                    </SectionCard>
                </Box>
                <Box flexDirection="column" gap={1} width="50%">
                    <SectionCard title="Retrospective">
                        <Box flexDirection="row" gap={1} marginBottom={1}>
                            <StatusBadge
                                label={data.retrospectiveExists ? `${data.retrospectiveEntryCount} entries` : "empty"}
                                status={data.retrospectiveExists ? "ok" : "idle"}
                            />
                        </Box>
                        <KeyValueRow label="Path" value={data.retrospectivePath} />
                    </SectionCard>
                </Box>
            </Box>
            <SectionCard title="Paths">
                <KeyValueRow label="Storage" value={data.storageDir} />
                <KeyValueRow label="Memory" value={data.memoryDir} />
            </SectionCard>
        </Box>
    );
}

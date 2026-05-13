import React from "react";
import { Box, Text } from "ink";
import type { DreamData } from "../../../cli/handlers/dream.handler.ts";
import { SectionCard, KeyValueRow } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";

interface DreamPageProps {
    data: DreamData;
    lastRun?: { users: number; drift: number; recall: number; contradiction: number; skipped: number };
}

export function DreamPage({ data, lastRun }: DreamPageProps): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <SectionCard title="Dream Stage">
                <Box flexDirection="row" gap={1} marginBottom={1}>
                    <StatusBadge label={data.enabled ? "enabled" : "disabled"} status={data.enabled ? "ok" : "warn"} />
                    <StatusBadge label={data.busy ? "busy" : "idle"} status={data.busy ? "active" : "idle"} />
                    <StatusBadge label={`${data.users} users`} status="info" />
                </Box>
                <KeyValueRow label="Status" value={data.busy ? "Running maintenance pass..." : "Idle"} />
                <KeyValueRow label="Tracked users" value={String(data.users)} />
            </SectionCard>

            {lastRun ? (
                <SectionCard title="Last Run Result">
                    <KeyValueRow label="Users" value={String(lastRun.users)} />
                    <KeyValueRow label="Drift repaired" value={String(lastRun.drift)} />
                    <KeyValueRow label="Recall reinforced" value={String(lastRun.recall)} />
                    <KeyValueRow label="Contradictions" value={String(lastRun.contradiction)} />
                    <KeyValueRow label="Skipped" value={String(lastRun.skipped)} />
                </SectionCard>
            ) : null}
        </Box>
    );
}

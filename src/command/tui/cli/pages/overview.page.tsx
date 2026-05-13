import React from "react";
import { Box, Text, useStdout } from "ink";
import type { OverviewData } from "../../../cli/handlers/overview.handler.ts";
import { SectionCard, KeyValueRow } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";
import { SelectableList, SelectableRow } from "../components/selectable.list.tsx";

interface OverviewPageProps {
    data: OverviewData;
    selectedChannelIndex: number;
}

export function OverviewPage({ data, selectedChannelIndex }: OverviewPageProps): React.ReactElement {
    const { stdout } = useStdout();
    const isWide = (stdout.columns ?? 120) >= 100;

    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
                <Box flexDirection="column" gap={1} width={isWide ? "50%" : "100%"}>
                    <RuntimeCard data={data.runtime} />
                    <GatewayCard data={data.gateway} />
                    <MemoryCard data={data.memory} />
                </Box>
                {isWide ? (
                    <Box flexDirection="column" gap={1} width="50%">
                        <DoctorCard checks={data.doctor} />
                    </Box>
                ) : null}
            </Box>

            <ChannelsCard channels={data.channels} selectedIndex={selectedChannelIndex} />

            {!isWide ? <DoctorCard checks={data.doctor} /> : null}
        </Box>
    );
}

function RuntimeCard({ data }: { data: OverviewData["runtime"] }): React.ReactElement {
    return (
        <SectionCard title="Runtime">
            <KeyValueRow label="Model" value={data.model} valueColor="green" />
            <KeyValueRow label="API mode" value={data.apiMode} />
            <KeyValueRow label="Sandbox" value={data.sandbox} />
            <KeyValueRow label="Project" value={data.project} />
            <KeyValueRow label="Config" value={data.configPath} />
        </SectionCard>
    );
}

function GatewayCard({ data }: { data: OverviewData["gateway"] }): React.ReactElement {
    return (
        <SectionCard title="Gateway">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label={data.running ? "running" : "stopped"} status={data.running ? "ok" : "warn"} />
                <StatusBadge label={`${data.connectedCount}/${data.totalCount}`} status={data.degradedCount > 0 ? "warn" : "ok"} />
                {data.streamingCount > 0 ? <StatusBadge label={`${data.streamingCount} streaming`} status="active" /> : null}
            </Box>
            <KeyValueRow label="URL" value={data.url} />
            {data.startedAt ? <KeyValueRow label="Started" value={data.startedAt} /> : null}
        </SectionCard>
    );
}

function MemoryCard({ data }: { data: OverviewData["memory"] }): React.ReactElement {
    return (
        <SectionCard title="Memory">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label="journal" status={data.memoryEnabled ? "ok" : "warn"} />
                <StatusBadge label="crystal" status={data.crystalEnabled ? "ok" : "warn"} />
            </Box>
            <KeyValueRow label="Storage" value={data.storageDir} />
        </SectionCard>
    );
}

function DoctorCard({ checks }: { checks: OverviewData["doctor"] }): React.ReactElement {
    const okCount = checks.filter((c) => c.status === "ok").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;

    return (
        <SectionCard title={`Doctor  ${okCount}/${checks.length} ok${warnCount > 0 ? `, ${warnCount} warn` : ""}`}>
            <Box flexDirection="column" gap={0}>
                {checks.map((check, index) => (
                    <Box key={index} flexDirection="row" gap={1}>
                        <Box width={3}>
                            <Text color={check.status === "ok" ? "green" : check.status === "warn" ? "yellow" : "red"}>
                                {check.status === "ok" ? "✓" : check.status === "warn" ? "△" : "✗"}
                            </Text>
                        </Box>
                        <Box width={22}>
                            <Text bold wrap="truncate">{check.name}</Text>
                        </Box>
                        <Text color="gray" wrap="truncate">
                            {check.detail}
                        </Text>
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

const STATE_SYMBOLS: Record<string, string> = {
    connected: "●",
    polling: "↻",
    processing: "…",
    replying: "↩",
    waiting: "◌",
    degraded: "△",
    needsSetup: "△",
    needsBinding: "◌",
    unknown: "×",
};

function ChannelsCard({ channels, selectedIndex }: { channels: OverviewData["channels"]; selectedIndex: number }): React.ReactElement {
    if (channels.length === 0) {
        return (
            <SectionCard title="Channels">
                <Text color="gray" dimColor>
                    No channels configured.
                </Text>
            </SectionCard>
        );
    }

    return (
        <SectionCard title={`Channels  (${channels.filter((c) => c.connected).length}/${channels.length} connected)`}>
            <SelectableList
                items={channels}
                selectedIndex={selectedIndex}
                emptyMessage="No channels."
                renderItem={(ch, idx, selected) => (
                    <SelectableRow isSelected={selected} prefix="›">
                        <Box flexDirection="row" gap={1} width="100%">
                            <Box width={3}>
                                <Text color={stateColor(ch.state)}>{STATE_SYMBOLS[ch.state] ?? "×"}</Text>
                            </Box>
                            <Box width={14}>
                                <Text bold wrap="truncate">{ch.name}</Text>
                            </Box>
                            <Box width={14}>
                                <Text color="gray" wrap="truncate">
                                    {ch.transport}
                                </Text>
                            </Box>
                            <Box width={14}>
                                <Text color={stateColor(ch.state)} wrap="truncate">
                                    {ch.state}
                                </Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {ch.lastError ? `△ ${ch.lastError}` : ch.detail || "—"}
                                </Text>
                            </Box>
                        </Box>
                    </SelectableRow>
                )}
            />
        </SectionCard>
    );
}

function stateColor(state: string): string {
    if (state === "connected") return "green";
    if (state === "degraded" || state === "needsSetup") return "red";
    if (state === "waiting" || state === "needsBinding") return "yellow";
    if (state === "processing" || state === "replying") return "cyan";
    if (state === "polling") return "blue";
    return "gray";
}

import React from "react";
import { Box, Text } from "ink";
import type { ConfigData } from "../../../cli/handlers/config.handler.ts";
import { SectionCard, KeyValueRow } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";

interface ConfigPageProps {
    data: ConfigData;
}

export function ConfigPage({ data }: ConfigPageProps): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1}>
                <Box flexDirection="column" gap={1} width="50%">
                    <ModelCard data={data.model} />
                    <GatewayCard data={data.gateway} />
                </Box>
                <Box flexDirection="column" gap={1} width="50%">
                    <SandboxCard data={data.sandbox} />
                    <MemoryCard data={data.memory} />
                </Box>
            </Box>
            <PathsCard data={data.paths} configPath={data.configPath} />
            <QuickActionsCard />
        </Box>
    );
}

function ModelCard({ data }: { data: ConfigData["model"] }): React.ReactElement {
    return (
        <SectionCard title="Model">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label={data.provider} status="info" />
                <StatusBadge label={data.apiMode} status="idle" />
                {data.apiKeyConfigured ? <StatusBadge label="key" status="ok" /> : <StatusBadge label="no key" status="warn" />}
            </Box>
            <KeyValueRow label="Provider" value={data.provider} />
            <KeyValueRow label="Model" value={data.model} />
            <KeyValueRow label="API mode" value={data.apiMode} />
            <KeyValueRow label="Kind" value={data.providerKind} />
            {data.baseUrl ? <KeyValueRow label="Base URL" value={data.baseUrl} /> : null}
        </SectionCard>
    );
}

function GatewayCard({ data }: { data: ConfigData["gateway"] }): React.ReactElement {
    return (
        <SectionCard title="Gateway">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label={`${data.host}:${data.port}`} status="info" />
                {data.stdio ? <StatusBadge label="stdio" status="active" /> : null}
            </Box>
            <KeyValueRow label="Host" value={data.host} />
            <KeyValueRow label="Port" value={String(data.port)} />
            <KeyValueRow label="Channels" value={`${data.channelCount} configured`} />
            <KeyValueRow label="Allowed" value={data.allowedChannels.join(", ") || "(none)"} />
        </SectionCard>
    );
}

function SandboxCard({ data }: { data: ConfigData["sandbox"] }): React.ReactElement {
    return (
        <SectionCard title="Sandbox">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label={data.mode} status={data.mode === "off" ? "warn" : "ok"} />
            </Box>
            <KeyValueRow label="Mode" value={data.mode} />
            <KeyValueRow label="MCP tool" value={data.mcpToolApproval} />
            <KeyValueRow label="Shell hook" value={data.shellHookApproval} />
            <KeyValueRow label="Plugin" value={data.pluginApproval} />
        </SectionCard>
    );
}

function MemoryCard({ data }: { data: ConfigData["memory"] }): React.ReactElement {
    return (
        <SectionCard title="Memory">
            <Box flexDirection="row" gap={1} marginBottom={1}>
                <StatusBadge label="journal" status={data.enabled ? "ok" : "warn"} />
                <StatusBadge label="crystal" status={data.crystalEnabled ? "ok" : "warn"} />
                <StatusBadge label="redis" status={data.redisEnabled ? "ok" : "warn"} />
            </Box>
            <KeyValueRow label="SQLite" value={data.sqliteEnabled ? "enabled" : "disabled"} />
            <KeyValueRow label="Surreal" value={data.surrealEnabled ? "enabled" : "disabled"} />
            <KeyValueRow label="Embedding" value={`${data.embeddingDimensions}d`} />
        </SectionCard>
    );
}

function PathsCard({ data, configPath }: { data: ConfigData["paths"]; configPath: string }): React.ReactElement {
    return (
        <SectionCard title="Paths">
            <KeyValueRow label="Config" value={configPath} />
            <KeyValueRow label="Home" value={data.home} />
            <KeyValueRow label="Project" value={data.projectDir} />
            <KeyValueRow label="Workspace" value={data.workspace} />
            <KeyValueRow label="Storage" value={data.storageDir} />
            <KeyValueRow label="Logs" value={data.logDir} />
        </SectionCard>
    );
}

function QuickActionsCard(): React.ReactElement {
    return (
        <SectionCard title="Quick Actions">
            <Box flexDirection="column" gap={0}>
                <Text color="gray">e — Open config in system editor</Text>
                <Text color="gray">r — Refresh config view</Text>
                <Text color="gray">Tab — Switch to next page</Text>
            </Box>
        </SectionCard>
    );
}

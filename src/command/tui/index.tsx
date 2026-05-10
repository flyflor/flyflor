import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import pc from "picocolors";
import type { FlyflorConfig } from "../../config/index.ts";
import { FlyFlorTokens, type FlyFlor } from "../../app.ts";
import type { BlackboardStep, BlackboardTurn } from "../../agent/blackboard/index.ts";
import type { GatewayStatusSnapshot } from "../../agent/gateway/index.ts";
import { BlackboardTurnStatus, BlackboardWorkerOutcome, ChannelLinkState } from "../../protocol/contracts/index.ts";
import { renderFlyflorBanner, resolveGatewaySnapshot } from "../cli/status.ts";
import { renderMarkdownToPlainText } from "../render/index.ts";

type TuiView = "overview" | "channels" | "blackboard";

interface TuiSnapshot {
    blackboardTurns: BlackboardTurn[];
    config: FlyflorConfig;
    gateway: GatewayStatusSnapshot;
    loadedAt: string;
}

export async function startTui(app: FlyFlor): Promise<void> {
    const loadSnapshot = () => readSnapshot(app);
    const initialSnapshot = await loadSnapshot();
    const instance = render(<FlyflorTui initialSnapshot={initialSnapshot} loadSnapshot={loadSnapshot} />);
    await instance.waitUntilExit();
}

interface FlyflorTuiProps {
    initialSnapshot: TuiSnapshot;
    loadSnapshot: () => Promise<TuiSnapshot>;
}

function FlyflorTui({ initialSnapshot, loadSnapshot }: FlyflorTuiProps): React.ReactElement {
    const app = useApp();
    const [view, setView] = useState<TuiView>("overview");
    const [snapshot, setSnapshot] = useState<TuiSnapshot>(initialSnapshot);
    const [error, setError] = useState<string | undefined>();

    useInput((input, key) => {
        if (key.escape || input === "q") {
            app.exit();
        }
        if (key.leftArrow || input === "h") {
            setView((current) => cycleView(current, -1));
        }
        if (key.rightArrow || input === "l") {
            setView((current) => cycleView(current, 1));
        }
        if (key.upArrow || input === "k") {
            setView((current) => cycleView(current, -1));
        }
        if (key.downArrow || input === "j") {
            setView((current) => cycleView(current, 1));
        }
        if (input === "r") {
            void refreshSnapshot(loadSnapshot, setSnapshot, setError);
        }
    });

    useEffect(() => {
        let active = true;
        const refresh = async () => {
            try {
                const next = await loadSnapshot();
                if (!active) {
                    return;
                }
                setSnapshot(next);
                setError(undefined);
            } catch (cause) {
                if (!active) {
                    return;
                }
                setError(errorMessage(cause));
            }
        };

        void refresh();
        const timer = setInterval(refresh, 1000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [loadSnapshot]);

    const tabs = useMemo(
        () =>
            [
                { id: "overview" as const, label: "Overview" },
                { id: "channels" as const, label: "Channels" },
                { id: "blackboard" as const, label: "Blackboard" },
            ] satisfies Array<{ id: TuiView; label: string }>,
        [],
    );

    return (
        <Box flexDirection="column" gap={1}>
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
                <Text color="cyan" bold>
                    {stripAnsi(renderFlyflorBanner())}
                </Text>
                <Text>
                    {pc.green("●")} {snapshot.config.model.providerId}/{snapshot.config.model.model}{" "}
                    {snapshot.gateway.gatewayRunning ? pc.green("gateway running") : pc.yellow("gateway stopped")}
                    {"  "}channels {snapshot.gateway.connectedCount}/{snapshot.gateway.channels.length}
                </Text>
                <Text dimColor>
                    refreshed {formatRelativeTime(snapshot.loadedAt)} • q/Esc quit • h/l or arrows switch • r refresh
                </Text>
                {error ? <Text color="red">{error}</Text> : null}
            </Box>

            <Box gap={1} flexGrow={1}>
                <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} width={24}>
                    <Text color="yellow">Views</Text>
                    {tabs.map((tab) => (
                        <Text key={tab.id} color={tab.id === view ? "cyan" : undefined}>
                            {tab.id === view ? "▶ " : "  "}
                            {tab.label}
                        </Text>
                    ))}
                </Box>

                <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} flexGrow={1}>
                    {view === "overview" ? <OverviewView snapshot={snapshot} /> : null}
                    {view === "channels" ? <ChannelsView snapshot={snapshot} /> : null}
                    {view === "blackboard" ? <BlackboardView snapshot={snapshot} /> : null}
                </Box>
            </Box>
        </Box>
    );
}

function OverviewView({ snapshot }: { snapshot: TuiSnapshot }): React.ReactElement {
    const latest = snapshot.blackboardTurns[0];
    return (
        <Box flexDirection="column" gap={1}>
            <SectionTitle title="Runtime" />
            <Text>Config: {snapshot.config.paths.home}/config.jsonc</Text>
            <Text>
                Gateway: {snapshot.gateway.host}:{snapshot.gateway.port}
            </Text>
            <Text>API mode: {snapshot.config.model.apiMode}</Text>
            <Text>Sandbox: {snapshot.config.sandbox.mode}</Text>
            <Text>
                Memory: {snapshot.config.memory.enabled ? "enabled" : "disabled"} • Crystal{" "}
                {snapshot.config.memory.crystal.enabled ? "enabled" : "disabled"}
            </Text>

            <SectionTitle title="Latest Blackboard" />
            {latest ? <BlackboardCompact turn={latest} /> : <Text dimColor>No blackboard turn yet.</Text>}
        </Box>
    );
}

function ChannelsView({ snapshot }: { snapshot: TuiSnapshot }): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <SectionTitle title="Messaging Platforms" />
            <Text dimColor>Stable links show state, transport, recent activity, and the latest error if any.</Text>
            <Box flexDirection="column" gap={1}>
                {snapshot.gateway.channels.map((channel) => (
                    <ChannelRow key={channel.name} channel={channel} />
                ))}
            </Box>
        </Box>
    );
}

function BlackboardView({ snapshot }: { snapshot: TuiSnapshot }): React.ReactElement {
    const turn = snapshot.blackboardTurns[0];
    return (
        <Box flexDirection="column" gap={1}>
            <SectionTitle title="Blackboard" />
            {!turn ? <Text dimColor>No blackboard turn yet.</Text> : <BlackboardDetail turn={turn} />}
        </Box>
    );
}

function SectionTitle({ title }: { title: string }): React.ReactElement {
    return (
        <Text color="cyan" bold>
            {`◆ ${title}`}
        </Text>
    );
}

function ChannelRow({ channel }: { channel: GatewayStatusSnapshot["channels"][number] }): React.ReactElement {
    const state = channel.state ?? ChannelLinkState.Unknown;
    return (
        <Box flexDirection="column">
            <Box justifyContent="space-between">
                <Text color={stateColor(state)}>
                    {stateSymbol(state)} {channel.name}
                </Text>
                <Text color={stateColor(state)}>{state}</Text>
            </Box>
            <Text dimColor>
                {channel.transport}
                {"  "}
                {renderActivity(channel)}
            </Text>
            <Text>{channel.lastError ? pc.red(truncate(channel.lastError, 120)) : (channel.detail ?? "")}</Text>
        </Box>
    );
}

function BlackboardCompact({ turn }: { turn: BlackboardTurn }): React.ReactElement {
    const latestStep = turn.steps.at(-1);
    return (
        <Box flexDirection="column">
            <Text color={turnStatusColor(turn.status)}>
                {stateSymbolForBlackboard(turn.status)} {turn.status} • {turn.steps.length} steps •{" "}
                {turn.decisions.length} decisions
            </Text>
            <Text dimColor>{renderMarkdownToPlainText(turn.goal)}</Text>
            {latestStep ? (
                <Text>
                    latest: round {latestStep.round} / {latestStep.workerRole} / {formatStepOutcome(latestStep)}
                </Text>
            ) : null}
        </Box>
    );
}

function BlackboardDetail({ turn }: { turn: BlackboardTurn }): React.ReactElement {
    return (
        <Box flexDirection="column" gap={1}>
            <Text color={turnStatusColor(turn.status)}>
                {stateSymbolForBlackboard(turn.status)} {turn.status} • {turn.steps.length} steps •{" "}
                {turn.decisions.length} decisions
            </Text>
            <Text>Goal: {renderMarkdownToPlainText(turn.goal)}</Text>
            <Text dimColor>
                Updated: {turn.updatedAt} • Started: {turn.createdAt}
            </Text>

            <SectionTitle title="Transcript" />
            {turn.messages.slice(-8).map((message) => (
                <Text key={message.id}>
                    {messageSymbol(message.role)} {message.role} {message.workerRole ? `(${message.workerRole})` : ""}{" "}
                    {message.visibility === "public" ? "❝" : "·"} {renderMarkdownToPlainText(message.content)}
                </Text>
            ))}

            <SectionTitle title="Steps" />
            {turn.steps.map((step) => (
                <Box key={step.id} flexDirection="column" marginBottom={1}>
                    <Text>
                        {stepSymbol(step)} round {step.round} {step.workerRole} {formatStepOutcome(step)}
                    </Text>
                    <Text dimColor>↘ {renderMarkdownToPlainText(step.inputSummary)}</Text>
                    <Text dimColor>↗ {renderMarkdownToPlainText(step.outputSummary)}</Text>
                    {step.blockers.length > 0 ? <Text color="yellow">! {step.blockers.join(" · ")}</Text> : null}
                    {step.newFacts.length > 0 ? <Text color="green">+ {step.newFacts.join(" · ")}</Text> : null}
                </Box>
            ))}

            {turn.decisions.length > 0 ? (
                <>
                    <SectionTitle title="Decisions" />
                    {turn.decisions.map((decision) => (
                        <Box key={decision.id} flexDirection="column" marginBottom={1}>
                            <Text>
                                {decision.kind} • {decision.reason}
                            </Text>
                            <Text dimColor>{renderMarkdownToPlainText(decision.prompt)}</Text>
                            <Text dimColor>
                                {decision.options.map((option) => `${option.id}:${option.label}`).join(" · ")}
                            </Text>
                        </Box>
                    ))}
                </>
            ) : null}
        </Box>
    );
}

function renderActivity(channel: GatewayStatusSnapshot["channels"][number]): string {
    const parts: string[] = [];
    if (channel.streaming) {
        parts.push(pc.cyan("… thinking"));
    }
    if (channel.lastInboundAt) {
        parts.push(`↘ ${formatRelativeTime(channel.lastInboundAt)}`);
    }
    if (channel.lastOutboundAt) {
        parts.push(`↗ ${formatRelativeTime(channel.lastOutboundAt)}`);
    }
    if (channel.lastErrorAt) {
        parts.push(pc.red(`△ ${formatRelativeTime(channel.lastErrorAt)}`));
    }
    return parts.length > 0 ? parts.join("  ") : "◌ idle";
}

function formatStepOutcome(step: BlackboardStep): string {
    const outcome = step.metadata.qaOutcome;
    if (outcome === BlackboardWorkerOutcome.Final) {
        return pc.green("final");
    }
    if (outcome === BlackboardWorkerOutcome.Blocked) {
        return pc.red("blocked");
    }
    if (outcome === BlackboardWorkerOutcome.Continue) {
        return pc.yellow("continue");
    }
    return "unknown";
}

function stepSymbol(step: BlackboardStep): string {
    const outcome = step.metadata.qaOutcome;
    if (outcome === BlackboardWorkerOutcome.Final) {
        return "●";
    }
    if (outcome === BlackboardWorkerOutcome.Blocked) {
        return "△";
    }
    return "…";
}

function messageSymbol(role: BlackboardTurn["messages"][number]["role"]): string {
    if (role === "system") {
        return "◦";
    }
    if (role === "assistant") {
        return "↩";
    }
    if (role === "planner") {
        return "◆";
    }
    if (role === "reviewer") {
        return "✓";
    }
    if (role === "critic") {
        return "❝";
    }
    if (role === "worker") {
        return "…";
    }
    return "↘";
}

function stateSymbolForBlackboard(status: BlackboardTurn["status"]): string {
    if (status === BlackboardTurnStatus.Running) {
        return "…";
    }
    if (status === BlackboardTurnStatus.NeedsUser) {
        return "⚑";
    }
    if (status === BlackboardTurnStatus.Converged) {
        return "●";
    }
    return "×";
}

function turnStatusColor(status: BlackboardTurn["status"]): string {
    if (status === BlackboardTurnStatus.Converged) {
        return "green";
    }
    if (status === BlackboardTurnStatus.NeedsUser) {
        return "yellow";
    }
    if (status === BlackboardTurnStatus.Running) {
        return "cyan";
    }
    return "red";
}

function stateColor(state: string): string {
    if (state === ChannelLinkState.Connected) {
        return "green";
    }
    if (
        state === ChannelLinkState.Polling ||
        state === ChannelLinkState.Replying ||
        state === ChannelLinkState.Processing
    ) {
        return "cyan";
    }
    if (state === ChannelLinkState.NeedsBinding || state === ChannelLinkState.Waiting) {
        return "yellow";
    }
    if (state === ChannelLinkState.Degraded || state === ChannelLinkState.NeedsSetup) {
        return "red";
    }
    return "gray";
}

function stateSymbol(state: string): string {
    if (state === ChannelLinkState.Connected) {
        return "●";
    }
    if (state === ChannelLinkState.Polling) {
        return "↻";
    }
    if (state === ChannelLinkState.Processing) {
        return "…";
    }
    if (state === ChannelLinkState.Replying) {
        return "↩";
    }
    if (state === ChannelLinkState.NeedsBinding || state === ChannelLinkState.Waiting) {
        return "◌";
    }
    if (state === ChannelLinkState.Degraded) {
        return "△";
    }
    return "×";
}

function cycleView(current: TuiView, delta: -1 | 1): TuiView {
    const order: TuiView[] = ["overview", "channels", "blackboard"];
    const index = order.indexOf(current);
    return order[(index + delta + order.length) % order.length] ?? "overview";
}

async function refreshSnapshot(
    loadSnapshot: () => Promise<TuiSnapshot>,
    setSnapshot: React.Dispatch<React.SetStateAction<TuiSnapshot>>,
    setError: React.Dispatch<React.SetStateAction<string | undefined>>,
): Promise<void> {
    try {
        const next = await loadSnapshot();
        setSnapshot(next);
        setError(undefined);
    } catch (cause) {
        setError(errorMessage(cause));
    }
}

async function readSnapshot(app: FlyFlor): Promise<TuiSnapshot> {
    const config = app.resolve(FlyFlorTokens.Config);
    const gateway = await resolveGatewaySnapshot(app);
    const blackboardTurns = await app.resolve(FlyFlorTokens.Blackboard).listRecentTurns(3);
    return {
        blackboardTurns,
        config,
        gateway,
        loadedAt: new Date().toISOString(),
    };
}

function formatRelativeTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
        return value;
    }
    const delta = Date.now() - time;
    if (Math.abs(delta) < 1000) {
        return "now";
    }
    const abs = Math.abs(delta);
    const suffix = delta >= 0 ? "ago" : "from now";
    if (abs < 60_000) {
        return `${Math.round(abs / 1000)}s ${suffix}`;
    }
    if (abs < 3_600_000) {
        return `${Math.round(abs / 60_000)}m ${suffix}`;
    }
    if (abs < 86_400_000) {
        return `${Math.round(abs / 3_600_000)}h ${suffix}`;
    }
    return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) {
        return value;
    }
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function stripAnsi(value: string): string {
    return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

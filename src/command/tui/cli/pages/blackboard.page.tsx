import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import type { BlackboardTurnItem, BlackboardTurnDetail } from "../../../cli/handlers/blackboard.handler.ts";
import { SectionCard } from "../components/layout.tsx";
import { StatusBadge } from "../components/status.badge.tsx";
import { SelectableList, SelectableRow } from "../components/selectable.list.tsx";

interface BlackboardPageProps {
    items: BlackboardTurnItem[];
    selectedIndex: number;
    detail?: BlackboardTurnDetail;
    mode: "list" | "detail";
    activeTab?: number;
}

export function BlackboardPage({ items, selectedIndex, detail, mode, activeTab = 0 }: BlackboardPageProps): React.ReactElement {
    if (mode === "detail" && detail) {
        return <BlackboardDetailView detail={detail} initialTab={activeTab} />;
    }
    return <BlackboardListCard items={items} selectedIndex={selectedIndex} />;
}

function BlackboardListCard({ items, selectedIndex }: { items: BlackboardTurnItem[]; selectedIndex: number }): React.ReactElement {
    return (
        <SectionCard title={`Blackboard Turns  (${items.length})`}>
            <SelectableList
                items={items}
                selectedIndex={selectedIndex}
                emptyMessage="No blackboard turns yet."
                renderItem={(turn, idx, selected) => (
                    <SelectableRow isSelected={selected} prefix="›">
                        <Box flexDirection="row" gap={1} width="100%">
                            <Box width={14}>
                                <Text color={statusColor(turn.status)} wrap="truncate">
                                    {turn.status}
                                </Text>
                            </Box>
                            <Box width={28}>
                                <Text bold wrap="truncate">{truncate(turn.goal, 26)}</Text>
                            </Box>
                            <Box width={8}>
                                <Text color="gray">{turn.stepCount}s</Text>
                            </Box>
                            <Box width={8}>
                                <Text color="gray">{turn.workerCount}w</Text>
                            </Box>
                            <Box flexGrow={1}>
                                <Text color="gray" dimColor wrap="truncate">
                                    {turn.updatedAt}
                                </Text>
                            </Box>
                        </Box>
                    </SelectableRow>
                )}
            />
        </SectionCard>
    );
}

function BlackboardDetailView({ detail, initialTab = 0 }: { detail: BlackboardTurnDetail; initialTab?: number }): React.ReactElement {
    const [activeTab, setActiveTab] = useState(initialTab);
    useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
    const { stdout } = useStdout();
    const isWide = (stdout.columns ?? 120) >= 100;

    const tabs = [
        { id: "summary", label: "Summary" },
        { id: "workers", label: `Workers (${detail.workers.length})` },
        { id: "steps", label: `Steps (${detail.steps.length})` },
        { id: "messages", label: `Messages (${detail.messages.length})` },
        { id: "decisions", label: `Decisions (${detail.decisions.length})` },
    ];

    return (
        <Box flexDirection="column" gap={1}>
            {/* Header */}
            <SectionCard title={truncate(detail.goal, 40)}>
                <Box flexDirection="row" gap={1} marginBottom={1}>
                    <StatusBadge label={detail.status} status={statusColor(detail.status) as "ok" | "warn" | "error" | "info" | "idle" | "active"} />
                    <StatusBadge label={`R${detail.budget.minRounds}-${detail.budget.maxRounds}`} status="info" />
                    {detail.completedAt ? <StatusBadge label="done" status="ok" /> : null}
                </Box>
                <Box flexDirection="row" gap={2}>
                    <Box flexDirection="column">
                        <Text color="gray" dimColor>id</Text>
                        <Text>{truncate(detail.id, 20)}</Text>
                    </Box>
                    <Box flexDirection="column">
                        <Text color="gray" dimColor>request</Text>
                        <Text>{truncate(detail.requestId, 20)}</Text>
                    </Box>
                    <Box flexDirection="column">
                        <Text color="gray" dimColor>updated</Text>
                        <Text>{detail.updatedAt}</Text>
                    </Box>
                </Box>
            </SectionCard>

            {/* Tabs */}
            <Box flexDirection="row" gap={2}>
                {tabs.map((tab, idx) => (
                    <Text
                        key={tab.id}
                        color={idx === activeTab ? "cyan" : "gray"}
                        bold={idx === activeTab}
                        dimColor={idx !== activeTab}
                    >
                        {idx === activeTab ? `[${tab.label}]` : ` ${tab.label} `}
                    </Text>
                ))}
            </Box>

            {/* Tab content */}
            {activeTab === 0 && <SummaryTab detail={detail} />}
            {activeTab === 1 && <WorkersTab workers={detail.workers} />}
            {activeTab === 2 && <StepsTab steps={detail.steps} />}
            {activeTab === 3 && <MessagesTab messages={detail.messages} />}
            {activeTab === 4 && <DecisionsTab decisions={detail.decisions} />}
        </Box>
    );
}

function SummaryTab({ detail }: { detail: BlackboardTurnDetail }): React.ReactElement {
    const { stdout } = useStdout();
    const isWide = (stdout.columns ?? 120) >= 100;

    return (
        <Box flexDirection="row" gap={1}>
            <Box flexDirection="column" gap={1} width={isWide ? "50%" : "100%"}>
                <SectionCard title="Budget">
                    <Text color="gray">Min rounds: {detail.budget.minRounds}</Text>
                    <Text color="gray">Max rounds: {detail.budget.maxRounds}</Text>
                    <Text color="gray">Hard max: {detail.budget.hardMaxRounds}</Text>
                </SectionCard>
                <SectionCard title="Workers ({detail.workers.length})">
                    {detail.workers.map((w, i) => (
                        <Box key={i} flexDirection="row" gap={1}>
                            <Box width={14}>
                                <Text bold wrap="truncate">{w.name}</Text>
                            </Box>
                            <Box width={12}>
                                <Text color="gray">{w.handoff}</Text>
                            </Box>
                            <Text color={statusColor(w.status)}>{w.status}</Text>
                        </Box>
                    ))}
                </SectionCard>
            </Box>
            {isWide ? (
                <Box flexDirection="column" gap={1} width="50%">
                    <SectionCard title="Latest Steps">
                        {detail.steps.slice(-3).map((s, i) => (
                            <Box key={i} flexDirection="row" gap={1}>
                                <Box width={6}>
                                    <Text color="gray">R{s.round}</Text>
                                </Box>
                                <Box width={14}>
                                    <Text bold wrap="truncate">{s.worker}</Text>
                                </Box>
                                <Box width={10}>
                                    <Text color={s.risk === "high" ? "red" : s.risk === "medium" ? "yellow" : "gray"}>
                                        {s.risk}
                                    </Text>
                                </Box>
                                <Box flexGrow={1}>
                                    <Text wrap="truncate">{truncate(s.summary, 40)}</Text>
                                </Box>
                            </Box>
                        ))}
                    </SectionCard>
                </Box>
            ) : null}
        </Box>
    );
}

function WorkersTab({ workers }: { workers: BlackboardTurnDetail["workers"] }): React.ReactElement {
    return (
        <SectionCard title={`Workers (${workers.length})`}>
            <Box flexDirection="column" gap={0}>
                {workers.map((w, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        <Box flexDirection="row" gap={1}>
                            <Text bold color="cyan">{w.name}</Text>
                            <Text color="gray">({w.role})</Text>
                            <Text color={statusColor(w.status)}>{w.status}</Text>
                        </Box>
                        <Text color="gray">stage: {w.stage} · handoff: {w.handoff}</Text>
                        {w.capabilities.length > 0 ? (
                            <Text color="gray" dimColor>capabilities: {w.capabilities.join(", ")}</Text>
                        ) : null}
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

function StepsTab({ steps }: { steps: BlackboardTurnDetail["steps"] }): React.ReactElement {
    return (
        <SectionCard title={`Steps (${steps.length})`}>
            <Box flexDirection="column" gap={0}>
                {steps.map((s, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        <Box flexDirection="row" gap={1}>
                            <Text color="gray">R{s.round}</Text>
                            <Text bold>{s.worker}</Text>
                            <Text color={s.risk === "high" ? "red" : s.risk === "medium" ? "yellow" : "gray"}>
                                {s.risk}
                            </Text>
                        </Box>
                        <Text wrap="wrap">{s.summary}</Text>
                        {s.blockers.length > 0 ? (
                            <Text color="red">blockers: {s.blockers.join("; ")}</Text>
                        ) : null}
                        {s.newFacts.length > 0 ? (
                            <Text color="green">facts: {s.newFacts.join("; ")}</Text>
                        ) : null}
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

function MessagesTab({ messages }: { messages: BlackboardTurnDetail["messages"] }): React.ReactElement {
    const publicMessages = messages.filter((m) => m.visibility === "public");
    return (
        <SectionCard title={`Transcript (${publicMessages.length} public / ${messages.length} total)`}>
            <Box flexDirection="column" gap={0}>
                {publicMessages.map((m, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        <Box flexDirection="row" gap={1}>
                            <Text bold color={m.role === "user" ? "cyan" : m.role === "assistant" ? "green" : "gray"}>
                                {m.role}
                            </Text>
                            {m.round ? <Text color="gray">R{m.round}</Text> : null}
                        </Box>
                        <Text wrap="wrap">{truncate(m.content, 200)}</Text>
                    </Box>
                ))}
            </Box>
        </SectionCard>
    );
}

function DecisionsTab({ decisions }: { decisions: BlackboardTurnDetail["decisions"] }): React.ReactElement {
    return (
        <SectionCard title={`Decisions (${decisions.length})`}>
            {decisions.length === 0 ? (
                <Text color="gray" dimColor>No decisions recorded.</Text>
            ) : (
                <Box flexDirection="column" gap={0}>
                    {decisions.map((d, i) => (
                        <Box key={i} flexDirection="column" marginBottom={1}>
                            <Box flexDirection="row" gap={1}>
                                <Text bold color="yellow">{d.kind}</Text>
                                <Text color="gray">{truncate(d.reason, 40)}</Text>
                            </Box>
                            <Text wrap="wrap">{d.prompt}</Text>
                            {d.options.length > 0 ? (
                                <Box flexDirection="column" marginTop={1}>
                                    {d.options.map((o, j) => (
                                        <Text key={j} color="gray">
                                            • {o.label} {o.description ? `— ${o.description}` : ""}
                                        </Text>
                                    ))}
                                </Box>
                            ) : null}
                        </Box>
                    ))}
                </Box>
            )}
        </SectionCard>
    );
}

function statusColor(status: string): string {
    if (status === "converged" || status === "final") return "green";
    if (status === "failed" || status === "error") return "red";
    if (status === "running" || status === "active") return "cyan";
    if (status === "needs-user" || status === "blocked") return "yellow";
    return "gray";
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

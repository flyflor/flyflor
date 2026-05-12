import React from "react";
import { Box, Text } from "ink";

interface TopBarProps {
    title: string;
    subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps): React.ReactElement {
    return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1}>
                <Text color="cyan" bold>
                    Flyflor
                </Text>
                <Text color="gray">│</Text>
                <Text bold>{title}</Text>
            </Box>
            {subtitle ? (
                <Text color="gray" dimColor>
                    {subtitle}
                </Text>
            ) : null}
        </Box>
    );
}

interface BottomHintProps {
    hints: string[];
}

export function BottomHint({ hints }: BottomHintProps): React.ReactElement {
    return (
        <Box flexDirection="row" gap={2}>
            {hints.map((hint, index) => (
                <Text key={index} color="gray" dimColor>
                    {hint}
                </Text>
            ))}
        </Box>
    );
}

interface SectionCardProps {
    title: string;
    children: React.ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps): React.ReactElement {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
            <Box marginBottom={1}>
                <Text color="cyan" bold>
                    {`◆ ${title}`}
                </Text>
            </Box>
            {children}
        </Box>
    );
}

interface KeyValueRowProps {
    label: string;
    value: string;
    valueColor?: string;
}

export function KeyValueRow({ label, value, valueColor }: KeyValueRowProps): React.ReactElement {
    return (
        <Box flexDirection="row">
            <Box width={16}>
                <Text color="gray" dimColor>
                    {label}
                </Text>
            </Box>
            <Text color={valueColor}>{value}</Text>
        </Box>
    );
}

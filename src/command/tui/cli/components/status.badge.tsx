import React from "react";
import { Box, Text } from "ink";

interface StatusBadgeProps {
    label: string;
    status: "ok" | "warn" | "error" | "info" | "idle" | "active";
}

const STATUS_COLORS: Record<string, string> = {
    ok: "green",
    warn: "yellow",
    error: "red",
    info: "blue",
    idle: "gray",
    active: "cyan",
};

export function StatusBadge({ label, status }: StatusBadgeProps): React.ReactElement {
    const color = STATUS_COLORS[status] ?? "white";
    return (
        <Box>
            <Text color={color} bold>
                {"["}
            </Text>
            <Text color={color}>{label}</Text>
            <Text color={color} bold>
                {"]"}
            </Text>
        </Box>
    );
}

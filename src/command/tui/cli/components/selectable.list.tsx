import React from "react";
import { Box, Text } from "ink";

interface SelectableListProps<T> {
    items: T[];
    selectedIndex: number;
    renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
    emptyMessage?: string;
}

export function SelectableList<T>({
    items,
    selectedIndex,
    renderItem,
    emptyMessage = "No items.",
}: SelectableListProps<T>): React.ReactElement {
    if (items.length === 0) {
        return (
            <Box>
                <Text color="gray" dimColor>
                    {emptyMessage}
                </Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column">
            {items.map((item, index) => (
                <Box key={index}>{renderItem(item, index, index === selectedIndex)}</Box>
            ))}
        </Box>
    );
}

interface SelectableRowProps {
    children: React.ReactNode;
    isSelected: boolean;
    prefix?: string;
}

export function SelectableRow({ children, isSelected, prefix }: SelectableRowProps): React.ReactElement {
    return (
        <Box flexDirection="row">
            {prefix ? (
                <Box width={2}>
                    <Text color={isSelected ? "cyan" : "gray"}>{isSelected ? "›" : " "}</Text>
                </Box>
            ) : null}
            <Box backgroundColor={isSelected ? "gray" : undefined}>{children}</Box>
        </Box>
    );
}

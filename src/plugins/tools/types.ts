import type { ToolResult } from '@/core';

export interface ClarificationOption {
    id: string;
    label: string;
    description: string;
    recommended: boolean;
}

export interface AskToolInput {
    question: string;
    options: ClarificationOption[];
}

export interface AskToolData {
    kind: 'ask';
    question: string;
    options: ClarificationOption[];
    other: true;
}

export interface ConfirmToolInput {
    question: string;
    recommended: boolean;
}

export interface ConfirmToolData {
    kind: 'confirm';
    question: string;
    default: boolean;
    recommended: boolean;
}

export interface ReadFileToolInput {
    path: string;
    maxBytes?: number;
}

export interface ReadFileToolData {
    path: string;
    content: string;
    truncated: boolean;
    bytes: number;
}

export interface CodeGraphToolInput {
    query: string;
    roots?: string[];
    maxResults?: number;
}

export interface CodeGraphMatch {
    path: string;
    line: number;
    text: string;
}

export interface CodeGraphToolData {
    query: string;
    matches: CodeGraphMatch[];
}

export interface DisabledToolInput {
    reason?: string;
}

export type DisabledToolResult = ToolResult<{ disabled: true; reason: string }>;

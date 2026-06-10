import type { ToolCall } from '@/core/tool';

export enum ExecutionStopReason {
    FINAL = 'final',
    ASK = 'ask',
    CONFIRM = 'confirm',
}

export interface ExecutionModelFinal {
    type: 'final';
    text: string;
}

export interface ExecutionModelToolUse {
    type: 'tool';
    calls: ToolCall[];
}

export type ExecutionModelAction = ExecutionModelFinal | ExecutionModelToolUse;

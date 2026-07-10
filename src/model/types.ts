export type MessageRole = 'system' | 'user' | 'assistant';

export interface TextMessage {
    role: MessageRole;
    content: string;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface AssistantMessage {
    role: 'assistant';
    content: string;
    toolCalls: ToolCall[];
    reasoning?: string;
}

export interface ToolMessage {
    role: 'tool';
    content: string;
    toolCallId: string;
    toolName: string;
    isError: boolean;
}

export type Message = TextMessage | AssistantMessage | ToolMessage;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export type StopReason = 'stop' | 'length' | 'toolUse';

export type StreamEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'tool_start'; index: number; id?: string; name?: string }
    | { type: 'tool_delta'; index: number; delta: string }
    | { type: 'tool_end'; index: number; call: ToolCall }
    | { type: 'done'; stopReason: StopReason };

export interface ModelResult {
    text: string;
    reasoning: string;
    toolCalls: ToolCall[];
    stopReason: StopReason;
}

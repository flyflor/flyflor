import type { FModelConfiguration } from '@/config';
import type { Message, StopReason, StreamEvent, ToolCall, ToolDefinition } from '../types';

export type ProtocolName = 'anthropic' | 'bedrock' | 'cohere' | 'gemini' | 'ollama' | 'openai' | 'responses';
export type ProtocolAuth = 'bearer' | 'optional' | 'anthropic' | 'google' | 'none';

export interface ModelOptions extends FModelConfiguration {
    contextLength: number;
    maxTokens: number;
}

export interface ProtocolSpec {
    name: ProtocolName;
    path: string;
    auth: ProtocolAuth;
    version?: string;
    json?: boolean;
    jsonStream?: boolean;
}

export interface ProviderError {
    message?: string;
    type?: string;
    code?: string;
}

export interface StreamingToolCall {
    index: number;
    id: string;
    name: string;
    partialArgs: string;
    started: boolean;
}

export interface ProtocolState {
    buffer: string;
    finished: boolean;
    toolCallsByIndex: Map<number, StreamingToolCall>;
    toolCallsById: Map<string, StreamingToolCall>;
    nextToolIndex: number;
}

export interface ProtocolAdapter {
    readonly name: ProtocolName;
    readonly tools: boolean;
    body(context: ProtocolContext): Record<string, unknown>;
    parseJson?(body: unknown): { text: string; stopReason: StopReason };
    parse(controller: ReadableStreamDefaultController<StreamEvent>, line: string, state: ProtocolState): boolean;
}

export interface ProtocolContext {
    config: ModelOptions;
    messages: Message[];
    spec: ProtocolSpec;
    adapter: ProtocolAdapter;
    tools?: ToolDefinition[];
}

export interface ByteReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
}

export interface ProtocolAttempt {
    spec: ProtocolSpec;
    adapter: ProtocolAdapter;
}

export type { ToolCall };

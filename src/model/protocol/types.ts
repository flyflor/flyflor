import type { FModelConfiguration } from '@/config';
import type { Message, StopReason, StreamEvent, ToolCall, ToolDefinition } from '../types';

/** ZH: 绑定到唯一 adapter 的线协议名。 EN: Wire protocol name bound to one adapter. */
export type ProtocolName = 'anthropic' | 'bedrock' | 'cohere' | 'gemini' | 'ollama' | 'openai' | 'responses';

/** ZH: 一次协议 attempt 所需的认证头风格。 EN: Authentication header style required by one protocol attempt. */
export type ProtocolAuth = 'bearer' | 'optional' | 'anthropic' | 'google' | 'none';

/** ZH: Agent scope 模型容量叠加进程级 provider endpoint 事实。 EN: Agent-scoped model capacity plus process-wide provider endpoint facts. */
export interface ModelOptions extends FModelConfiguration {
    contextLength: number;
    maxTokens: number;
}

/** ZH: 一次协议 attempt 的精确 path、auth 与响应形状契约。 EN: Exact path, auth, and response-shape contract for one protocol attempt. */
export interface ProtocolSpec {
    name: ProtocolName;
    path: string;
    auth: ProtocolAuth;
    version?: string;
    json?: boolean;
    jsonStream?: boolean;
}

/** ZH: 从线协议 JSON 规范化的 provider 错误负载。 EN: Provider error payload normalized from wire JSON. */
export interface ProviderError {
    message?: string;
    type?: string;
    code?: string;
}

/** ZH: 终态事件前累计的流式工具调用。 EN: In-flight streamed tool call accumulated until the terminal event. */
export interface StreamingToolCall {
    index: number;
    id: string;
    name: string;
    partialArgs: string;
    started: boolean;
}

/** ZH: 一次 provider 响应流的隔离 parser 状态。 EN: Isolated parser state for one provider response stream. */
export interface ProtocolState {
    buffer: string;
    finished: boolean;
    toolCallsByIndex: Map<number, StreamingToolCall>;
    toolCallsById: Map<string, StreamingToolCall>;
    nextToolIndex: number;
}

/**
 * ZH: 由 protocol 包持有的线协议适配器；body 构造请求，parse 发出 StreamEvent。
 * EN: Wire adapter owned by the protocol package; body builds the request, parse emits StreamEvents.
 */
export interface ProtocolAdapter {
    readonly name: ProtocolName;
    readonly tools: boolean;
    body(context: ProtocolContext): Record<string, unknown>;
    parseJson?(body: unknown): { text: string; stopReason: StopReason };
    parse(controller: ReadableStreamDefaultController<StreamEvent>, line: string, state: ProtocolState): boolean;
}

/** ZH: 一次 provider attempt 的完整请求上下文。 EN: Fully resolved request context for one provider attempt. */
export interface ProtocolContext {
    config: ModelOptions;
    messages: Message[];
    spec: ProtocolSpec;
    adapter: ProtocolAdapter;
    tools?: ToolDefinition[];
}

/** ZH: 一次 HTTP 响应体读循环的字节源。 EN: Byte source for one HTTP response body read loop. */
export interface ByteReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
}

/** ZH: 为一个已配置 provider 解析出的 spec 与 adapter 对。 EN: Spec and adapter pair resolved for one configured provider. */
export interface ProtocolAttempt {
    spec: ProtocolSpec;
    adapter: ProtocolAdapter;
}

export type { ToolCall };

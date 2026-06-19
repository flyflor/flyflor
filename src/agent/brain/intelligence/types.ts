import type { AgentMemory, AgentToolCall } from '@/agent/memory';
import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/configuration';

export interface ProviderErrorShape {
    message?: string;
    type?: string;
    code?: string;
}

/**
 * One tool advertised to the model for a request.
 * `parameters` is a JSON-Schema object handed straight to the provider as the function input schema.
 */
export interface IntelligenceToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * Reason a provider turn ended.
 * `stop`/`length` finish a plain text answer; `toolUse` means the model emitted tool calls and expects results.
 */
export type IntelligenceStopReason = 'stop' | 'length' | 'toolUse';

/**
 * One structured event from a provider turn.
 *
 * Text turns emit only `text_delta` then `done`. Tool turns also emit `toolcall_start`/`toolcall_delta`
 * per streamed function call and `toolcall_end` with the finalized call. This replaces the old text-only
 * `ReadableStream<string>` contract so the research loop can read tool calls natively.
 */
export type IntelligenceEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'toolcall_start'; index: number; id?: string; name?: string }
    | { type: 'toolcall_delta'; index: number; delta: string }
    | { type: 'toolcall_end'; index: number; toolCall: AgentToolCall }
    | { type: 'done'; stopReason: IntelligenceStopReason };

/**
 * One streaming tool call being assembled across provider deltas.
 * `partialArgs` is the raw concatenated JSON-arguments buffer; it is re-parsed each delta and dropped at
 * finalize so only the parsed `arguments` object survives.
 */
export interface StreamingToolCall {
    index: number;
    id: string;
    name: string;
    partialArgs: string;
    started: boolean;
}

/**
 * Per-request mutable state threaded through `parseLine`.
 *
 * Text adapters only touch `finished`. Tool-capable adapters use the two maps to route interleaved
 * `tool_calls[]` deltas to the right call: resolve by provider `index` first, fall back to `id`. The
 * factory creates one `ProtocolStreamState` per request, so accumulation survives across lines.
 */
export interface ProtocolStreamState {
    buffer: string;
    finished: boolean;
    toolCallsByIndex: Map<number, StreamingToolCall>;
    toolCallsById: Map<string, StreamingToolCall>;
    nextToolIndex: number;
}

export interface ProtocolAdapter {
    readonly name: FModelProtocolName;
    body(context: ProtocolBuildContext): Record<string, unknown>;
    parseLine(controller: ReadableStreamDefaultController<IntelligenceEvent>, line: string, state: ProtocolStreamState): boolean;
}

export interface ProtocolBuildContext {
    config: FModelConfiguration;
    messages: AgentMemory[];
    protocol: FModelProtocolConfiguration;
    adapter: ProtocolAdapter;
    model: string;
    maxTokens: number;
    tools?: IntelligenceToolDefinition[];
}

/**
 * Minimal byte-stream reader contract Flyflor needs from `fetch().body.getReader()`.
 * Bun and DOM lib readers differ in extra methods, so the LLM parser depends only on `read()` and `cancel()`.
 */
export interface LlmByteStreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
}

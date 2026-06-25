import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/configuration';
import type { ActionRequest } from '@/plugins/tools';

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

export interface ProviderActionRequestMessage {
    role: AgentChatRole.Assistant;
    content: string;
    actionRequests: ActionRequest[];
    reasoning?: string;
}

export interface ProviderActionResultMessage {
    role: 'action';
    content: string;
    actionRequestId: string;
    actionName: string;
    isError: boolean;
}

export type ProviderMessage = AgentMemory | ProviderActionRequestMessage | ProviderActionResultMessage;

/**
 * Reason a provider turn ended.
 * `stop`/`length` finish a plain text answer; `toolUse` means the model emitted action requests and expects results.
 */
export type IntelligenceStopReason = 'stop' | 'length' | 'toolUse';

/**
 * One structured event from a provider turn.
 *
 * Text turns emit only `text_delta` then `done`. Provider wire tool calls are normalized into action
 * events so only protocol adapters know wire names such as OpenAI `tool_calls`.
 */
export type IntelligenceEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'action_start'; index: number; id?: string; name?: string }
    | { type: 'action_delta'; index: number; delta: string }
    | { type: 'action_end'; index: number; request: ActionRequest }
    | { type: 'done'; stopReason: IntelligenceStopReason };

/**
 * One streaming action request being assembled across provider deltas.
 * `partialArgs` is the raw concatenated JSON-arguments buffer; it is re-parsed each delta and dropped at
 * finalize so only the parsed `arguments` object survives.
 */
export interface StreamingActionRequest {
    index: number;
    id: string;
    name: string;
    partialArgs: string;
    started: boolean;
}

/**
 * Per-request mutable state threaded through `parseLine`.
 *
 * Text adapters only touch `finished`. Action-capable adapters use the two maps to route interleaved
 * provider wire tool-call deltas to the right request: resolve by provider `index` first, fall back to `id`. The
 * factory creates one `ProtocolStreamState` per request, so accumulation survives across lines.
 */
export interface ProtocolStreamState {
    buffer: string;
    finished: boolean;
    actionRequestsByIndex: Map<number, StreamingActionRequest>;
    actionRequestsById: Map<string, StreamingActionRequest>;
    nextActionIndex: number;
}

export interface ProtocolAdapter {
    readonly name: FModelProtocolName;
    body(context: ProtocolBuildContext): Record<string, unknown>;
    parseLine(controller: ReadableStreamDefaultController<IntelligenceEvent>, line: string, state: ProtocolStreamState): boolean;
}

export interface ProtocolBuildContext {
    config: FModelConfiguration;
    messages: ProviderMessage[];
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

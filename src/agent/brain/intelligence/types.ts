import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/configuration';
import type { ActionRequest } from '@/plugins';

/**
 * EN: Provider-specific error payload shape before normalization.
 * ZH: 规范化前的 provider 专有错误结构。
 */
export interface ProviderErrorShape {
    message?: string;
    type?: string;
    code?: string;
}

/**
 * EN: One tool advertised to the model for a request.
 * ZH: 单次请求中暴露给模型的一个工具。
 *
 * EN: `parameters` is a JSON-Schema object handed straight to the provider as the function input schema.
 * ZH: `parameters` 是直接交给 provider 作为函数输入 schema 的 JSON-Schema 对象。
 */
export interface IntelligenceToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/**
 * EN: One assistant message that asks the runtime to execute tools.
 * ZH: 一条要求运行时执行工具的 assistant 消息。
 */
export interface ProviderActionRequestMessage {
    role: AgentChatRole.Assistant;
    content: string;
    actionRequests: ActionRequest[];
    reasoning?: string;
}

/**
 * EN: One tool result message fed back to the provider.
 * ZH: 回传给 provider 的单条工具结果消息。
 */
export interface ProviderActionResultMessage {
    role: 'action';
    content: string;
    actionRequestId: string;
    actionName: string;
    isError: boolean;
}

/**
 * EN: Union of all message shapes Flyflor sends to a provider.
 * ZH: Flyflor 发送给 provider 的全部消息形态联合。
 */
export type ProviderMessage = AgentMemory | ProviderActionRequestMessage | ProviderActionResultMessage;

/**
 * EN: Reason a provider request ended.
 * ZH: provider request 结束的原因。
 *
 * EN: `stop`/`length` finish a plain text answer; `toolUse` means the model emitted action requests and expects results.
 * ZH: `stop`/`length` 表示普通文本回答结束；`toolUse` 表示模型发出了 action request 并等待结果。
 */
export type IntelligenceStopReason = 'stop' | 'length' | 'toolUse';

/**
 * EN: One structured event from a provider request.
 * ZH: provider request 产生的一条结构化事件。
 *
 * EN: Text requests emit only `text_delta` then `done`. Provider wire tool calls are normalized into action
 * events so only protocol adapters know wire names such as OpenAI `tool_calls`.
 * ZH: 文本 request 只发出 `text_delta` 和 `done`。provider 线协议工具调用会被规范化成 action event，因此只有 protocol adapter 需要知道 OpenAI `tool_calls` 这类线协议名称。
 */
export type IntelligenceEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'action_start'; index: number; id?: string; name?: string }
    | { type: 'action_delta'; index: number; delta: string }
    | { type: 'action_end'; index: number; request: ActionRequest }
    | { type: 'done'; stopReason: IntelligenceStopReason };

/**
 * EN: One streaming action request being assembled across provider deltas.
 * ZH: 跨 provider delta 逐步组装的一条 streaming action request。
 *
 * EN: `partialArgs` is the raw concatenated JSON-arguments buffer; it is re-parsed each delta and dropped at
 * finalize so only the parsed `arguments` object survives.
 * ZH: `partialArgs` 是拼接后的原始 JSON 参数缓冲；每次 delta 后都会重新解析，finalize 后只保留解析后的 `arguments` 对象。
 */
export interface StreamingActionRequest {
    index: number;
    id: string;
    name: string;
    partialArgs: string;
    started: boolean;
}

/**
 * EN: Per-request mutable state threaded through `parseLine`.
 * ZH: 贯穿 `parseLine` 的单请求可变状态。
 *
 * EN: Text adapters only touch `finished`. Action-capable adapters use the two maps to route interleaved
 * provider wire tool-call deltas to the right request: resolve by provider `index` first, fall back to `id`. The
 * factory creates one `ProtocolStreamState` per request, so accumulation survives across lines.
 * ZH: 文本 adapter 只会改 `finished`。支持 action 的 adapter 使用两个 map 将交错的 provider 工具调用 delta 路由到正确请求：优先按 provider `index`，再退回 `id`。factory 为每个请求创建一个 `ProtocolStreamState`，所以累积状态能跨行保留。
 */
export interface ProtocolStreamState {
    buffer: string;
    finished: boolean;
    actionRequestsByIndex: Map<number, StreamingActionRequest>;
    actionRequestsById: Map<string, StreamingActionRequest>;
    nextActionIndex: number;
}

/**
 * EN: Protocol adapter contract for one provider wire format.
 * ZH: 单个 provider 线协议格式的适配器契约。
 */
export interface ProtocolAdapter {
    readonly name: FModelProtocolName;
    body(context: ProtocolBuildContext): Record<string, unknown>;
    parseLine(controller: ReadableStreamDefaultController<IntelligenceEvent>, line: string, state: ProtocolStreamState): boolean;
}

/**
 * EN: Input context used to build one provider request.
 * ZH: 构造单次 provider 请求时使用的输入上下文。
 */
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
 * EN: Minimal byte-stream reader contract Flyflor needs from `fetch().body.getReader()`.
 * ZH: Flyflor 从 `fetch().body.getReader()` 需要的最小字节流 reader 契约。
 *
 * EN: Bun and DOM lib readers differ in extra methods, so the LLM parser depends only on `read()` and `cancel()`.
 * ZH: Bun 和 DOM lib reader 的额外方法不同，所以 LLM parser 只依赖 `read()` 和 `cancel()`。
 */
export interface LlmByteStreamReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
}

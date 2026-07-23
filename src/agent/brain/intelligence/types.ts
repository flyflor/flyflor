import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { type FModelConfiguration, type FModelProtocolConfiguration, FModelProtocolName } from '@/configuration';
import type { ActionRequest } from '@/plugins';

/**
 * EN: Provider-specific error payload shape before normalization.
 * ZH: 规范化前的 provider 专有错误结构。
 */
export interface ProviderErrorShape {
    /** EN: Human-readable provider error message. ZH: 可读的 provider 错误消息。 */
    message?: string;
    /** EN: Provider error type label. ZH: provider 错误类型标签。 */
    type?: string;
    /** EN: Provider error code. ZH: provider 错误码。 */
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
    /** EN: Tool name advertised to the model. ZH: 暴露给模型的工具名。 */
    name: string;
    /** EN: Tool description advertised to the model. ZH: 暴露给模型的工具描述。 */
    description: string;
    /** EN: JSON-Schema object used as the function input schema. ZH: 作为函数输入 schema 的 JSON-Schema 对象。 */
    parameters: Record<string, unknown>;
}

/**
 * EN: One assistant message that asks the runtime to execute tools.
 * ZH: 一条要求运行时执行工具的 assistant 消息。
 */
export interface ProviderActionRequestMessage {
    /** EN: Fixed assistant role marker. ZH: 固定的 assistant 角色标记。 */
    role: AgentChatRole.Assistant;
    /** EN: Visible text emitted alongside the action requests. ZH: 随 action request 一起产生的可见文本。 */
    content: string;
    /** EN: Actions the model asked the runtime to execute. ZH: 模型请求运行时执行的 action 列表。 */
    actionRequests: ActionRequest[];
    /** EN: Provider thinking text replayed with the action requests. ZH: 随 action request 一起回放的 provider 思考文本。 */
    reasoning?: string;
}

/**
 * EN: One tool result message fed back to the provider.
 * ZH: 回传给 provider 的单条工具结果消息。
 */
export interface ProviderActionResultMessage {
    /** EN: Fixed action role marker. ZH: 固定的 action 角色标记。 */
    role: 'action';
    /** EN: Serialized tool result payload. ZH: 序列化后的工具结果负载。 */
    content: string;
    /** EN: Identifier of the action request this result answers. ZH: 该结果所答复的 action request 标识。 */
    actionRequestId: string;
    /** EN: Name of the executed action. ZH: 已执行 action 的名称。 */
    actionName: string;
    /** EN: Whether the action failed. ZH: 该 action 是否失败。 */
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
    /** EN: Visible text delta. ZH: 可见文本增量。 */
    | { type: 'text_delta'; text: string }
    /** EN: Provider reasoning delta. ZH: provider 思考增量。 */
    | { type: 'reasoning_delta'; text: string }
    /** EN: A streamed action request started. ZH: 一条流式 action request 开始。 */
    | { type: 'action_start'; index: number; id?: string; name?: string }
    /** EN: Argument fragment of a streamed action request. ZH: 流式 action request 的参数片段。 */
    | { type: 'action_delta'; index: number; delta: string }
    /** EN: A streamed action request finished with parsed arguments. ZH: 一条流式 action request 完成，参数已解析。 */
    | { type: 'action_end'; index: number; request: ActionRequest }
    /** EN: Terminal event carrying the stop reason. ZH: 携带结束原因的终止事件。 */
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
    /** EN: Internal index of the request within one provider response. ZH: 该请求在单次 provider 响应中的内部序号。 */
    index: number;
    /** EN: Provider wire identifier of the request. ZH: 请求的 provider 线协议标识。 */
    id: string;
    /** EN: Wire tool name of the request. ZH: 请求的线协议工具名。 */
    name: string;
    /** EN: Raw concatenated JSON-arguments buffer. ZH: 拼接后的原始 JSON 参数缓冲。 */
    partialArgs: string;
    /** EN: Whether the action_start event has been emitted. ZH: 是否已发出 action_start 事件。 */
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
    /** EN: Undecoded line buffer carried across byte chunks. ZH: 跨字节块保留的未解析行缓冲。 */
    buffer: string;
    /** EN: Whether a terminal event has been seen. ZH: 是否已见到终止事件。 */
    finished: boolean;
    /** EN: Streaming action requests indexed by provider index. ZH: 按 provider index 索引的流式 action request。 */
    actionRequestsByIndex: Map<number, StreamingActionRequest>;
    /** EN: Streaming action requests indexed by provider id. ZH: 按 provider id 索引的流式 action request。 */
    actionRequestsById: Map<string, StreamingActionRequest>;
    /** EN: Next internal index used when the provider omits one. ZH: provider 未提供 index 时使用的下一个内部序号。 */
    nextActionIndex: number;
}

/**
 * EN: Protocol adapter contract for one provider wire format.
 * ZH: 单个 provider 线协议格式的适配器契约。
 */
export interface ProtocolAdapter {
    /** EN: Protocol name this adapter handles. ZH: 该适配器处理的 protocol 名称。 */
    readonly name: FModelProtocolName;
    /** EN: Builds the provider request body for one call. ZH: 为单次调用构造 provider 请求体。 */
    body(context: ProtocolBuildContext): Record<string, unknown>;
    /** EN: Parses one wire line into normalized events; returns true on the terminal event. ZH: 把一行线协议数据解析为规范化事件；遇到终止事件时返回 true。 */
    parseLine(controller: ReadableStreamDefaultController<IntelligenceEvent>, line: string, state: ProtocolStreamState): boolean;
}

/**
 * EN: Input context used to build one provider request.
 * ZH: 构造单次 provider 请求时使用的输入上下文。
 */
export interface ProtocolBuildContext {
    /** EN: Resolved model configuration. ZH: 解析后的模型配置。 */
    config: FModelConfiguration;
    /** EN: Provider-local messages to send. ZH: 待发送的 provider-local 消息。 */
    messages: ProviderMessage[];
    /** EN: Protocol endpoint configuration being attempted. ZH: 当前尝试的 protocol 端点配置。 */
    protocol: FModelProtocolConfiguration;
    /** EN: Adapter owning the wire format. ZH: 负责线协议的适配器。 */
    adapter: ProtocolAdapter;
    /** EN: Model name for this request. ZH: 本次请求使用的模型名。 */
    model: string;
    /** EN: Maximum output tokens for this request. ZH: 本次请求的最大输出 token 数。 */
    maxTokens: number;
    /** EN: Tools advertised to the model. ZH: 暴露给模型的工具列表。 */
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
    /** EN: Reads the next byte chunk. ZH: 读取下一个字节块。 */
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    /** EN: Cancels the byte stream. ZH: 取消字节流。 */
    cancel(reason?: unknown): Promise<void>;
}

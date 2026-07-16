/** ZH: 面向模型的文本消息可接受角色。 EN: Roles accepted on model-bound text messages. */
export type MessageRole = 'system' | 'user' | 'assistant';

/** ZH: 不含工具负载的纯文本消息。 EN: Plain text message without tool payload. */
export interface TextMessage {
    role: MessageRole;
    content: string;
}

/** ZH: 流终态后发出的一次完整工具调用。 EN: One complete tool call emitted after a stream terminal. */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/** ZH: 可携带工具调用与可选推理文本的 assistant 回合。 EN: Assistant turn that may carry tool calls and optional reasoning text. */
export interface AssistantMessage {
    role: 'assistant';
    content: string;
    toolCalls: ToolCall[];
    reasoning?: string;
}

/** ZH: 按 toolCallId 关联、供 provider replay 的工具结果消息。 EN: Tool result message correlated by toolCallId for provider replay. */
export interface ToolMessage {
    role: 'tool';
    content: string;
    toolCallId: string;
}

/** ZH: 一次 Investigation 请求的判别式模型历史条目。 EN: Discriminated model history entry for one Investigation request. */
export type Message = TextMessage | AssistantMessage | ToolMessage;

/**
 * ZH: 面向模型的工具 schema。与 tool 域 `ToolDefinition` 结构孪生（model 不得 import tool）。
 * EN: Model-facing tool schema. Structural twin of tool `ToolDefinition` (model cannot import tool).
 */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** ZH: 一次 provider attempt 后的规范化终态停因。 EN: Normalized terminal stop reason after one provider attempt. */
export type StopReason = 'stop' | 'length' | 'toolUse';

/**
 * ZH: 由 ModelService 归并为一次 ModelResult 的有序流事件。
 * EN: Ordered stream events reduced into one ModelResult by ModelService.
 */
export type StreamEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'reasoning_delta'; text: string }
    | { type: 'tool_start'; index: number; id?: string; name?: string }
    | { type: 'tool_delta'; index: number; delta: string }
    | { type: 'tool_end'; index: number; call: ToolCall }
    | { type: 'done'; stopReason: StopReason };

/** ZH: 一次模型请求归并后的文本、推理与工具调用。 EN: Fully reduced text, reasoning, and tool calls from one model request. */
export interface ModelResult {
    text: string;
    reasoning: string;
    toolCalls: ToolCall[];
}

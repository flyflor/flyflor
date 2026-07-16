import type { Message, StreamEvent, ToolCall } from '../types';
import type { ProtocolAdapter, ProtocolContext, ProtocolState, ProviderError, StreamingToolCall } from './types';

/** ZH: OpenAI 兼容流式 tool_call 增量片段。 EN: OpenAI-compatible streamed tool_call delta fragment. */
interface WireToolDelta {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}

/** ZH: OpenAI 适配器使用的 Chat Completions SSE chunk 形状。 EN: One Chat Completions SSE chunk shape used by the OpenAI adapter. */
interface ChatCompletionChunk {
    error?: ProviderError;
    choices?: Array<{
        delta?: {
            content?: string;
            reasoning_content?: string;
            refusal?: string;
            tool_calls?: WireToolDelta[];
        };
        finish_reason?: string | null;
    }>;
}

/**
 * ZH: 支持 tools 的 Chat Completions 线适配器；将 SSE delta 映射为 StreamEvent，直到唯一 finish_reason。
 * EN: Chat Completions wire adapter with tools; maps SSE deltas to StreamEvents until one finish_reason.
 */
export const openAIAdapter: ProtocolAdapter = {
    name: 'openai',
    tools: true,
    body: (context: ProtocolContext) => {
        const body: Record<string, unknown> = {
            model: context.config.model,
            messages: chatMessages(context.messages),
            stream: true,
            max_tokens: context.config.maxTokens,
        };
        if (context.tools && context.tools.length > 0) {
            body.tools = context.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            }));
        } else if (hasToolHistory(context.messages)) {
            body.tools = [];
        }
        return body;
    },
    parse: (controller, line, state) => {
        const data = sseData(line);
        if (data === undefined) return false;
        if (data === '[DONE]') {
            throw Error('OpenAI stream ended without a finish reason');
        }
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        if (parsed.error !== undefined) throw Error(providerError(parsed.error, 'Model provider stream error'));
        const choice = parsed.choices?.[0];
        if (typeof choice?.delta?.refusal === 'string') throw Error(`OpenAI refusal: ${choice.delta.refusal}`);
        const text = choice?.delta?.content;
        if (typeof text === 'string' && text.length > 0) controller.enqueue({ type: 'text_delta', text });
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) controller.enqueue({ type: 'reasoning_delta', text: reasoning });
        for (const delta of choice?.delta?.tool_calls ?? []) accumulateToolCall(controller, state, delta);
        const finishReason = choice?.finish_reason;
        if (typeof finishReason !== 'string' || finishReason.length === 0) return false;
        const stopReason = terminal(finishReason);
        finalizeToolCalls(controller, state);
        controller.enqueue({ type: 'done', stopReason });
        return true;
    },
};

/** ZH: 将一次 tool_call delta 累计进 ProtocolState 并发出 tool_start/tool_delta。 EN: Accumulates one tool_call delta into ProtocolState and emits tool_start/tool_delta. */
function accumulateToolCall(
    controller: ReadableStreamDefaultController<StreamEvent>,
    state: ProtocolState,
    delta: WireToolDelta,
): void {
    const call = resolveToolCall(state, delta);
    if (!call.started) {
        call.started = true;
        controller.enqueue({ type: 'tool_start', index: call.index, id: call.id || undefined, name: call.name || undefined });
    }
    if (delta.id && !call.id) {
        call.id = delta.id;
        state.toolCallsById.set(delta.id, call);
    }
    if (delta.function?.name && !call.name) call.name = delta.function.name;
    const fragment = delta.function?.arguments;
    if (typeof fragment !== 'string' || fragment.length === 0) return;
    call.partialArgs += fragment;
    controller.enqueue({ type: 'tool_delta', index: call.index, delta: fragment });
}

/** ZH: 按 provider index 或 id 解析或创建 StreamingToolCall。 EN: Resolves or creates one StreamingToolCall by provider index or id. */
function resolveToolCall(state: ProtocolState, delta: WireToolDelta): StreamingToolCall {
    const providerIndex = typeof delta.index === 'number' ? delta.index : undefined;
    let call = providerIndex !== undefined ? state.toolCallsByIndex.get(providerIndex) : undefined;
    if (!call && delta.id) call = state.toolCallsById.get(delta.id);
    if (call) return call;
    const index = providerIndex ?? state.nextToolIndex;
    call = { index, id: delta.id ?? '', name: delta.function?.name ?? '', partialArgs: '', started: false };
    state.toolCallsByIndex.set(index, call);
    if (delta.id) state.toolCallsById.set(delta.id, call);
    state.nextToolIndex = Math.max(state.nextToolIndex, index + 1);
    return call;
}

/** ZH: 在终态为每个完整流式工具调用发出 tool_end。 EN: Emits tool_end for every complete streamed tool call at the terminal. */
function finalizeToolCalls(controller: ReadableStreamDefaultController<StreamEvent>, state: ProtocolState): void {
    const calls = [...state.toolCallsByIndex.values()].sort((left, right) => left.index - right.index);
    for (const pending of calls) {
        if (pending.id.length === 0 || pending.name.length === 0) throw Error(`Streamed tool call is incomplete: ${pending.index}`);
        const call: ToolCall = { id: pending.id, name: pending.name, arguments: parseArguments(pending.partialArgs) };
        controller.enqueue({ type: 'tool_end', index: pending.index, call });
    }
}

/** ZH: 将 OpenAI finish_reason 映射为 StopReason。 EN: Maps OpenAI finish_reason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' | 'toolUse' {
    if (reason === 'stop') return 'stop';
    if (reason === 'length') return 'length';
    if (reason === 'tool_calls' || reason === 'function_call') return 'toolUse';
    throw Error(`OpenAI finish reason is unsupported: ${reason}`);
}

/** ZH: 将累计的工具参数 JSON 解析为对象。 EN: Parses accumulated tool argument JSON into one object. */
function parseArguments(partialArgs: string): Record<string, unknown> {
    const trimmed = partialArgs.trim();
    if (trimmed.length === 0) return {};
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw Error('Tool arguments must be a JSON object');
    return parsed as Record<string, unknown>;
}

/** ZH: 将模型 Message 投影为 Chat Completions 线消息。 EN: Projects model Messages into Chat Completions wire messages. */
function chatMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        if (message.role === 'tool') {
            return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
        }
        if ('toolCalls' in message) {
            return {
                role: 'assistant',
                content: message.content,
                ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
                tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
            };
        }
        return { role: message.role, content: message.content };
    });
}

/** ZH: 报告历史是否已含工具调用或工具结果。 EN: Reports whether history already contains tool calls or tool results. */
function hasToolHistory(messages: Message[]): boolean {
    return messages.some((message) => message.role === 'tool' || ('toolCalls' in message && message.toolCalls.length > 0));
}

/** ZH: 提取 SSE data 负载；忽略非 data 行。 EN: Extracts SSE data payload; ignores non-data lines. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

/** ZH: 将 ProviderError 格式化为 reject 消息。 EN: Formats one ProviderError into a reject message. */
function providerError(error: ProviderError | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

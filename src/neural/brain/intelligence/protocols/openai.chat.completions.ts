import { ChatRole } from '@/neural/brain/types';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceEvent, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState, ProviderErrorShape, ProviderMessage, StreamingActionRequest } from '../types';
import { FModelProtocolName } from '@/configuration';

/**
 * EN: One streamed OpenAI `tool_calls[]` delta fragment.
 * ZH: 一个 OpenAI `tool_calls[]` 流式 delta 片段。
 */
interface WireActionDelta {
    /** EN: Provider-side tool call index. ZH: provider 侧的工具调用序号。 */
    index?: number;
    /** EN: Provider-side tool call identifier. ZH: provider 侧的工具调用标识。 */
    id?: string;
    /** EN: Function name and argument fragment. ZH: 函数名与参数片段。 */
    function?: { name?: string; arguments?: string };
}

/**
 * EN: Minimal shape of one OpenAI chat-completion stream chunk.
 * ZH: 单个 OpenAI chat-completion 流式 chunk 的最小形态。
 */
interface ChatCompletionChunk {
    /** EN: Error payload carried by the chunk. ZH: chunk 携带的错误负载。 */
    error?: ProviderErrorShape;
    /** EN: Streamed choices with deltas and finish reasons. ZH: 携带增量与结束原因的流式 choice 列表。 */
    choices?: Array<{
        delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: WireActionDelta[];
        };
        finish_reason?: string | null;
    }>;
}

/**
 * EN: Protocol adapter for the OpenAI chat-completions SSE wire format,
 * including streamed `tool_calls` normalization into action events.
 * ZH: OpenAI chat-completions SSE 线协议适配器，包括把流式 `tool_calls`
 * 规范化为 action 事件。
 */
export const openAIChatCompletionsAdapter: ProtocolAdapter = {
    name: FModelProtocolName.OpenAIChatCompletions,
    body: (context: ProtocolBuildContext) => {
        const body: Record<string, unknown> = {
            model: context.model,
            messages: chatMessages(context.messages),
            stream: true,
            max_tokens: context.maxTokens,
        };
        if (context.tools && context.tools.length > 0) {
            body.tools = context.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            }));
        } else if (hasActionHistory(context.messages)) {
            // OpenAI-compatible proxies require a tools param once the local provider replay carries actions.
            body.tools = [];
        }
        return body;
    },
    parseLine: (controller, line, state) => {
        const data = sseData(line);
        if (data === undefined) return false;
        if (data === '[DONE]') {
            finalizeActionRequests(controller, state);
            controller.enqueue({ type: 'done', stopReason: state.actionRequestsByIndex.size > 0 ? 'toolUse' : 'stop' });
            return true;
        }
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        if (parsed.error !== undefined) throw Error(providerErrorMessage(parsed.error, 'LLM provider stream error'));
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue({ type: 'text_delta', text: delta });
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) controller.enqueue({ type: 'reasoning_delta', text: reasoning });
        for (const actionDelta of choice?.delta?.tool_calls ?? []) {
            accumulateActionRequest(controller, state, actionDelta);
        }
        const finishReason = choice?.finish_reason;
        if (typeof finishReason === 'string' && finishReason.length > 0) {
            finalizeActionRequests(controller, state);
            controller.enqueue({ type: 'done', stopReason: finishReason === 'tool_calls' || finishReason === 'function_call' ? 'toolUse' : finishReason === 'length' ? 'length' : 'stop' });
            return true;
        }
        return false;
    },
};

/**
 * EN: Routes one streamed OpenAI `tool_calls[]` delta to its internal action request, creating it on first sight.
 * ZH: 将一个 OpenAI `tool_calls[]` streaming delta 路由到内部 action request，首次出现时创建该请求。
 *
 * EN: Resolution is by provider `index` first, then `id`, because compatible providers disagree on which
 * they send on continuation deltas. Arguments are appended raw; the authoritative parse happens at finalize.
 * ZH: 解析时优先使用 provider `index`，再使用 `id`，因为兼容 provider 在后续 delta 中发送哪个字段并不一致。参数先按原文追加，最终解析在 finalize 阶段完成。
 */
function accumulateActionRequest(controller: ReadableStreamDefaultController<IntelligenceEvent>, state: ProtocolStreamState, delta: WireActionDelta): void {
    const request = resolveActionRequest(state, delta);
    if (!request.started) {
        request.started = true;
        controller.enqueue({ type: 'action_start', index: request.index, id: request.id || undefined, name: request.name || undefined });
    }
    if (delta.id && !request.id) {
        request.id = delta.id;
        state.actionRequestsById.set(delta.id, request);
    }
    if (delta.function?.name && !request.name) request.name = delta.function.name;
    const fragment = delta.function?.arguments;
    if (typeof fragment === 'string' && fragment.length > 0) {
        request.partialArgs += fragment;
        controller.enqueue({ type: 'action_delta', index: request.index, delta: fragment });
    }
}

/**
 * EN: Resolves the internal action request for one wire delta, creating it on first sight.
 * ZH: 为一个线协议 delta 解析出对应的内部 action request，首次出现时创建。
 */
function resolveActionRequest(state: ProtocolStreamState, delta: WireActionDelta): StreamingActionRequest {
    const providerIndex = typeof delta.index === 'number' ? delta.index : undefined;
    let request = providerIndex !== undefined ? state.actionRequestsByIndex.get(providerIndex) : undefined;
    if (!request && delta.id) request = state.actionRequestsById.get(delta.id);
    if (request) return request;
    const index = providerIndex ?? state.nextActionIndex;
    request = { index, id: delta.id ?? '', name: delta.function?.name ?? '', partialArgs: '', started: false };
    state.actionRequestsByIndex.set(index, request);
    if (delta.id) state.actionRequestsById.set(delta.id, request);
    state.nextActionIndex = Math.max(state.nextActionIndex, index + 1);
    return request;
}

/**
 * EN: Emits an `action_end` for every accumulated action request with parsed object arguments.
 * ZH: 为每条已累积 action request 发出 `action_end`，并把参数解析成对象。
 */
function finalizeActionRequests(controller: ReadableStreamDefaultController<IntelligenceEvent>, state: ProtocolStreamState): void {
    const requests = [...state.actionRequestsByIndex.values()].sort((left, right) => left.index - right.index);
    for (const request of requests) {
        const actionRequest: ActionRequest = { id: request.id, name: request.name, arguments: parseActionArguments(request.partialArgs) };
        controller.enqueue({ type: 'action_end', index: request.index, request: actionRequest });
    }
}

/**
 * EN: Best-effort parse of a streamed action-argument buffer.
 * ZH: 尽力解析 streaming action 参数缓冲。
 *
 * EN: The model usually emits valid JSON, but an early stop can truncate it; an empty object is a safe fallback
 * so the loop can surface a tool error instead of throwing inside the stream.
 * ZH: 模型通常会输出合法 JSON，但提前停止可能截断参数；空对象是更安全的回退，能让循环暴露工具错误，而不是在 stream 内抛错。
 */
function parseActionArguments(partialArgs: string): Record<string, unknown> {
    const trimmed = partialArgs.trim();
    if (trimmed.length === 0) return {};
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * EN: Projects provider-local messages to OpenAI chat messages.
 * ZH: 将 provider-local 消息投影为 OpenAI chat messages。
 *
 * EN: MindMessage stays pure; action request/result
 * replay exists only in the research call stack and is mapped back to OpenAI wire fields here.
 * ZH: `MindMessage` 保持纯净；action request/result replay 只存在于 research 调用栈，并在这里映射回 OpenAI 线协议字段。
 */
function chatMessages(messages: ProviderMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        if (message.role === 'action') {
            return { role: 'tool', tool_call_id: message.actionRequestId, content: message.content };
        }
        if (message.role === ChatRole.Assistant && 'actionRequests' in message) {
            return {
                role: 'assistant',
                // DeepSeek rejects replayed assistant tool-call messages when `content` is null.
                content: message.content,
                // DeepSeek thinking mode rejects a replayed tool-call request unless its reasoning is passed back.
                ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
                tool_calls: message.actionRequests.map((request) => ({
                    id: request.id,
                    type: 'function',
                    function: { name: request.name, arguments: JSON.stringify(request.arguments) },
                })),
            };
        }
        return { role: message.role, content: message.content };
    });
}

/**
 * EN: Whether the message list already carries action request/result replay.
 * ZH: 消息列表是否已携带 action request/result 回放。
 */
function hasActionHistory(messages: ProviderMessage[]): boolean {
    return messages.some((message) => message.role === 'action' || (message.role === ChatRole.Assistant && 'actionRequests' in message));
}

/**
 * EN: Extracts the JSON payload from one SSE `data:` line.
 * ZH: 从一行 SSE `data:` 中提取 JSON 负载。
 */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

/**
 * EN: Formats a provider error payload into one readable message.
 * ZH: 把 provider 错误负载格式化为一条可读消息。
 */
function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

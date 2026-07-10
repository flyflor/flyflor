import type { Message, StreamEvent, ToolCall } from '../types';
import type { ProtocolAdapter, ProtocolContext, ProtocolState, ProviderError, StreamingToolCall } from './types';

interface WireToolDelta {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}

interface ChatCompletionChunk {
    error?: ProviderError;
    choices?: Array<{
        delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: WireToolDelta[];
        };
        finish_reason?: string | null;
    }>;
}

export const openAIAdapter: ProtocolAdapter = {
    name: 'openai',
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
            finalizeToolCalls(controller, state);
            controller.enqueue({ type: 'done', stopReason: state.toolCallsByIndex.size > 0 ? 'toolUse' : 'stop' });
            return true;
        }
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        if (parsed.error !== undefined) throw Error(providerError(parsed.error, 'Model provider stream error'));
        const choice = parsed.choices?.[0];
        const text = choice?.delta?.content;
        if (typeof text === 'string' && text.length > 0) controller.enqueue({ type: 'text_delta', text });
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) controller.enqueue({ type: 'reasoning_delta', text: reasoning });
        for (const delta of choice?.delta?.tool_calls ?? []) accumulateToolCall(controller, state, delta);
        const finishReason = choice?.finish_reason;
        if (typeof finishReason !== 'string' || finishReason.length === 0) return false;
        finalizeToolCalls(controller, state);
        controller.enqueue({
            type: 'done',
            stopReason: finishReason === 'tool_calls' || finishReason === 'function_call'
                ? 'toolUse'
                : finishReason === 'length' ? 'length' : 'stop',
        });
        return true;
    },
};

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

function finalizeToolCalls(controller: ReadableStreamDefaultController<StreamEvent>, state: ProtocolState): void {
    const calls = [...state.toolCallsByIndex.values()].sort((left, right) => left.index - right.index);
    for (const pending of calls) {
        const call: ToolCall = { id: pending.id, name: pending.name, arguments: parseArguments(pending.partialArgs) };
        controller.enqueue({ type: 'tool_end', index: pending.index, call });
    }
}

function parseArguments(partialArgs: string): Record<string, unknown> {
    const trimmed = partialArgs.trim();
    if (trimmed.length === 0) return {};
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw Error('Tool arguments must be a JSON object');
    return parsed as Record<string, unknown>;
}

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

function hasToolHistory(messages: Message[]): boolean {
    return messages.some((message) => message.role === 'tool' || 'toolCalls' in message);
}

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function providerError(error: ProviderError | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

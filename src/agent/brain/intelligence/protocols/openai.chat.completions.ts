import { FModelProtocolName } from '@/config';
import { AgentChatRole, type AgentMemory, type AgentToolCall } from '@/agent/memory';
import type { IntelligenceEvent, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState, ProviderErrorShape, StreamingToolCall } from '../types';

interface ToolCallDelta {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}

interface ChatCompletionChunk {
    error?: ProviderErrorShape;
    choices?: Array<{
        delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: ToolCallDelta[];
        };
        finish_reason?: string | null;
    }>;
}

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
        } else if (hasToolHistory(context.messages)) {
            // OpenAI-compatible proxies require a tools param once the conversation carries tool calls/results.
            body.tools = [];
        }
        return body;
    },
    parseLine: (controller, line, state) => {
        const data = sseData(line);
        if (data === undefined) return false;
        if (data === '[DONE]') {
            finalizeToolCalls(controller, state);
            controller.enqueue({ type: 'done', stopReason: state.toolCallsByIndex.size > 0 ? 'toolUse' : 'stop' });
            return true;
        }
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        if (parsed.error !== undefined) throw Error(providerErrorMessage(parsed.error, 'LLM provider stream error'));
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue({ type: 'text_delta', text: delta });
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === 'string' && reasoning.length > 0) controller.enqueue({ type: 'reasoning_delta', text: reasoning });
        for (const toolCallDelta of choice?.delta?.tool_calls ?? []) {
            accumulateToolCall(controller, state, toolCallDelta);
        }
        const finishReason = choice?.finish_reason;
        if (typeof finishReason === 'string' && finishReason.length > 0) {
            finalizeToolCalls(controller, state);
            controller.enqueue({ type: 'done', stopReason: finishReason === 'tool_calls' || finishReason === 'function_call' ? 'toolUse' : finishReason === 'length' ? 'length' : 'stop' });
            return true;
        }
        return false;
    },
};

/**
 * Routes one streamed `tool_calls[]` delta to its accumulating call, creating it on first sight.
 * Resolution is by provider `index` first, then `id`, because compatible providers disagree on which
 * they send on continuation deltas. Arguments are appended raw; the authoritative parse happens at finalize.
 */
function accumulateToolCall(controller: ReadableStreamDefaultController<IntelligenceEvent>, state: ProtocolStreamState, delta: ToolCallDelta): void {
    const call = resolveToolCall(state, delta);
    if (!call.started) {
        call.started = true;
        controller.enqueue({ type: 'toolcall_start', index: call.index, id: call.id || undefined, name: call.name || undefined });
    }
    if (delta.id && !call.id) {
        call.id = delta.id;
        state.toolCallsById.set(delta.id, call);
    }
    if (delta.function?.name && !call.name) call.name = delta.function.name;
    const fragment = delta.function?.arguments;
    if (typeof fragment === 'string' && fragment.length > 0) {
        call.partialArgs += fragment;
        controller.enqueue({ type: 'toolcall_delta', index: call.index, delta: fragment });
    }
}

function resolveToolCall(state: ProtocolStreamState, delta: ToolCallDelta): StreamingToolCall {
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

/**
 * Emits a `toolcall_end` for every accumulated call with its arguments parsed into an object.
 * Idempotent: a finished call is removed from the index so a later `[DONE]` does not re-emit it.
 */
function finalizeToolCalls(controller: ReadableStreamDefaultController<IntelligenceEvent>, state: ProtocolStreamState): void {
    const calls = [...state.toolCallsByIndex.values()].sort((left, right) => left.index - right.index);
    for (const call of calls) {
        const toolCall: AgentToolCall = { id: call.id, name: call.name, arguments: parseToolArguments(call.partialArgs) };
        controller.enqueue({ type: 'toolcall_end', index: call.index, toolCall });
    }
}

/**
 * Best-effort parse of a streamed tool-argument buffer.
 * The model usually emits valid JSON, but an early stop can truncate it; an empty object is a safe fallback
 * so the loop can surface a tool error instead of throwing inside the stream.
 */
function parseToolArguments(partialArgs: string): Record<string, unknown> {
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
 * Projects working memory to OpenAI chat messages, mapping tool calls and tool results back to the wire.
 * Assistant tool calls become `tool_calls[]` with stringified arguments; tool results become `role:"tool"`
 * messages keyed by `tool_call_id`.
 */
function chatMessages(messages: AgentMemory[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        if (message.role === AgentChatRole.Tool) {
            return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
        }
        if (message.role === AgentChatRole.Assistant && 'toolCalls' in message) {
            return {
                role: 'assistant',
                // DeepSeek rejects replayed assistant tool-call messages when `content` is null.
                content: message.content,
                // DeepSeek thinking mode rejects a replayed tool-call turn unless its reasoning is passed back.
                ...(message.reasoning ? { reasoning_content: message.reasoning } : {}),
                tool_calls: message.toolCalls.map((toolCall) => ({
                    id: toolCall.id,
                    type: 'function',
                    function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
                })),
            };
        }
        return { role: message.role, content: message.content };
    });
}

function hasToolHistory(messages: AgentMemory[]): boolean {
    return messages.some((message) => message.role === AgentChatRole.Tool || (message.role === AgentChatRole.Assistant && 'toolCalls' in message));
}

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

import { AgentChatRole } from '@/agent/memory';
import type { ActionRequest } from '@/plugins/tools';
import type { IntelligenceEvent, ProtocolAdapter, ProtocolBuildContext, ProtocolStreamState, ProviderErrorShape, ProviderMessage, StreamingActionRequest } from '../types';
import { FModelProtocolName } from '@/configuration';

interface WireActionDelta {
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
            tool_calls?: WireActionDelta[];
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
 * Routes one streamed OpenAI `tool_calls[]` delta to its internal action request, creating it on first sight.
 * Resolution is by provider `index` first, then `id`, because compatible providers disagree on which
 * they send on continuation deltas. Arguments are appended raw; the authoritative parse happens at finalize.
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
 * Emits an `action_end` for every accumulated action request with its arguments parsed into an object.
 * Idempotent: a finished call is removed from the index so a later `[DONE]` does not re-emit it.
 */
function finalizeActionRequests(controller: ReadableStreamDefaultController<IntelligenceEvent>, state: ProtocolStreamState): void {
    const requests = [...state.actionRequestsByIndex.values()].sort((left, right) => left.index - right.index);
    for (const request of requests) {
        const actionRequest: ActionRequest = { id: request.id, name: request.name, arguments: parseActionArguments(request.partialArgs) };
        controller.enqueue({ type: 'action_end', index: request.index, request: actionRequest });
    }
}

/**
 * Best-effort parse of a streamed action-argument buffer.
 * The model usually emits valid JSON, but an early stop can truncate it; an empty object is a safe fallback
 * so the loop can surface a tool error instead of throwing inside the stream.
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
 * Projects provider-local messages to OpenAI chat messages. AgentMemory stays pure; action request/result
 * replay exists only in the research call stack and is mapped back to OpenAI wire fields here.
 */
function chatMessages(messages: ProviderMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        if (message.role === 'action') {
            return { role: 'tool', tool_call_id: message.actionRequestId, content: message.content };
        }
        if (message.role === AgentChatRole.Assistant && 'actionRequests' in message) {
            return {
                role: 'assistant',
                // DeepSeek rejects replayed assistant tool-call messages when `content` is null.
                content: message.content,
                // DeepSeek thinking mode rejects a replayed tool-call turn unless its reasoning is passed back.
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

function hasActionHistory(messages: ProviderMessage[]): boolean {
    return messages.some((message) => message.role === 'action' || (message.role === AgentChatRole.Assistant && 'actionRequests' in message));
}

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

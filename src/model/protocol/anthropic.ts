import type { Message } from '../types';
import type { ProtocolAdapter, ProtocolContext, ProviderError } from './types';

/**
 * ZH: Anthropic Messages 线适配器；纯文本，单独投影 system blocks。
 * EN: Anthropic Messages wire adapter; text-only, projects system blocks separately.
 */
export const anthropicAdapter: ProtocolAdapter = {
    name: 'anthropic',
    tools: false,
    body: (context: ProtocolContext) => {
        const { system, messages } = project(context.messages);
        return {
            model: context.config.model,
            messages,
            ...(system.length > 0 ? { system: system.join('\n\n') } : {}),
            stream: true,
            max_tokens: context.config.maxTokens,
        };
    },
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const type = parsed.type;
        if (type === 'content_block_delta') {
            const delta = parsed.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === 'text_delta' && delta.text) controller.enqueue({ type: 'text_delta', text: delta.text });
        } else if (type === 'message_delta') {
            const stop = (parsed.delta as { stop_reason?: string } | undefined)?.stop_reason;
            if (stop) {
                controller.enqueue({ type: 'done', stopReason: terminal(stop) });
                return true;
            }
        } else if (type === 'message_stop') {
            throw Error('Anthropic message stopped without a stop reason');
        } else if (type === 'error') {
            throw Error(errorMessage(parsed.error as ProviderError | undefined, 'Anthropic stream error'));
        }
        return false;
    },
};

/** ZH: 为 Messages API 将 system 文本与对话消息拆分。 EN: Splits system text from conversation messages for the Messages API. */
function project(messages: Message[]): { system: string[]; messages: Array<{ role: string; content: string }> } {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: string }> = [];
    for (const message of messages) {
        if (message.role === 'tool') continue;
        if (message.role === 'system') system.push(message.content);
        else conversation.push({ role: message.role, content: message.content });
    }
    return { system, messages: conversation };
}

/** ZH: 将 Anthropic stop_reason 映射为 StopReason。 EN: Maps Anthropic stop_reason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' {
    if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
    if (reason === 'max_tokens') return 'length';
    throw Error(`Anthropic stop reason is unsupported: ${reason}`);
}

/** ZH: 提取 SSE data 负载；忽略非 data 行。 EN: Extracts SSE data payload; ignores non-data lines. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

/** ZH: 将 ProviderError 格式化为 reject 消息。 EN: Formats one ProviderError into a reject message. */
function errorMessage(error: ProviderError | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

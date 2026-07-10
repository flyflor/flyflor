import type { Message } from '../types';
import type { ProtocolAdapter, ProtocolContext, ProviderError } from './types';

export const anthropicAdapter: ProtocolAdapter = {
    name: 'anthropic',
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
                controller.enqueue({ type: 'done', stopReason: stop === 'max_tokens' ? 'length' : 'stop' });
                return true;
            }
        } else if (type === 'message_stop') {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        } else if (type === 'error') {
            throw Error(errorMessage(parsed.error as ProviderError | undefined, 'Anthropic stream error'));
        }
        return false;
    },
};

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

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

function errorMessage(error: ProviderError | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

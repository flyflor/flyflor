import type { ProtocolAdapter, ProtocolContext } from './types';

export const cohereAdapter: ProtocolAdapter = {
    name: 'cohere',
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        messages: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_tokens: context.config.maxTokens,
    }),
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const content = (parsed.delta as { message?: { content?: { text?: string } | Array<{ text?: string }> } } | undefined)?.message?.content;
        if (Array.isArray(content)) {
            for (const item of content) if (item.text) controller.enqueue({ type: 'text_delta', text: item.text });
        } else if (content?.text) {
            controller.enqueue({ type: 'text_delta', text: content.text });
        }
        if (parsed.type === 'message-end' || parsed.type === 'stream-end' || typeof parsed.finish_reason === 'string') {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        }
        return false;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

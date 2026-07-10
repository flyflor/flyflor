import type { ProtocolAdapter, ProtocolContext } from './types';

export const ollamaAdapter: ProtocolAdapter = {
    name: 'ollama',
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        messages: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        options: { num_predict: context.config.maxTokens },
    }),
    parse: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (!data) return false;
        const parsed = JSON.parse(data) as { message?: { content?: string }; response?: string; done?: boolean };
        const text = parsed.message?.content ?? parsed.response;
        if (text) controller.enqueue({ type: 'text_delta', text });
        if (parsed.done === true) {
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

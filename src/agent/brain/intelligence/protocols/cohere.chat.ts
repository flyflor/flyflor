import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';

export const cohereChatAdapter: ProtocolAdapter = {
    name: FModelProtocolName.CohereChat,
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        messages: context.messages.filter((message) => message.role !== 'action').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const type = parsed.type;
        const delta = parsed.delta as { message?: { content?: { text?: string } | Array<{ text?: string }> } } | undefined;
        const content = delta?.message?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (typeof item.text === 'string' && item.text.length > 0) controller.enqueue({ type: 'text_delta', text: item.text });
            }
        } else if (typeof content?.text === 'string' && content.text.length > 0) {
            controller.enqueue({ type: 'text_delta', text: content.text });
        }
        if (type === 'message-end' || type === 'stream-end' || typeof parsed.finish_reason === 'string') {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        }
        return false;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';

export const cohereChatAdapter: ProtocolAdapter = {
    name: FModelProtocolName.CohereChat,
    defaultPath: '/v2/chat',
    auth: 'bearer',
    body: (context: ProtocolBuildContext) => ({
        model: context.resolvedModel,
        messages: context.request.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = parseJson<Record<string, unknown>>(data);
        const type = parsed.type;
        const delta = parsed.delta as { message?: { content?: { text?: string } | Array<{ text?: string }> } } | undefined;
        const content = delta?.message?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (typeof item.text === 'string' && item.text.length > 0) controller.enqueue(item.text);
            }
        } else if (typeof content?.text === 'string' && content.text.length > 0) {
            controller.enqueue(content.text);
        }
        return type === 'message-end' || type === 'stream-end' || typeof parsed.finish_reason === 'string';
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured Cohere terminal event',
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function parseJson<T>(data: string): T {
    try {
        return JSON.parse(data) as T;
    } catch (error) {
        throw Object.assign(Error('LLM provider returned non-JSON stream data'), {
            detail: { data, cause: error instanceof Error ? error.message : String(error) },
        });
    }
}

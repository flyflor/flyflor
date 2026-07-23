import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';

/**
 * EN: Protocol adapter for the Ollama chat/generate JSON-lines wire format.
 * ZH: Ollama chat/generate JSON 行线协议适配器。
 */
export const ollamaAdapter: ProtocolAdapter = {
    name: FModelProtocolName.Ollama,
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        messages: context.messages.filter((message) => message.role !== 'action').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        options: { num_predict: context.maxTokens },
    }),
    parseLine: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (data.length === 0) return false;
        const parsed = JSON.parse(data) as { message?: { content?: string }; response?: string; done?: boolean };
        const delta = parsed.message?.content ?? parsed.response;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue({ type: 'text_delta', text: delta });
        if (parsed.done === true) {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        }
        return false;
    },
};

/**
 * EN: Extracts the JSON payload from one SSE `data:` line.
 * ZH: 从一行 SSE `data:` 中提取 JSON 负载。
 */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

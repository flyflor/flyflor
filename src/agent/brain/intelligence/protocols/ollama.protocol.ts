import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';

export const ollamaAdapter: ProtocolAdapter = {
    name: FModelProtocolName.Ollama,
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        messages: context.messages,
        stream: true,
        options: { num_predict: context.maxTokens },
    }),
    parseLine: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (data.length === 0) return false;
        const parsed = JSON.parse(data) as { message?: { content?: string }; response?: string; done?: boolean };
        const delta = parsed.message?.content ?? parsed.response;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue(delta);
        return parsed.done === true;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

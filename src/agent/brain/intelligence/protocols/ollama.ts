import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';

export const ollamaAdapter: ProtocolAdapter = {
    name: FModelProtocolName.Ollama,
    defaultPath: '/api/chat',
    auth: 'optionalBearer',
    body: (context: ProtocolBuildContext) => ({
        model: context.resolvedModel,
        messages: context.request.messages,
        stream: true,
        options: { num_predict: context.maxTokens },
    }),
    parseLine: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (data.length === 0) return false;
        const parsed = parseJson<{ message?: { content?: string }; response?: string; done?: boolean }>(data);
        const delta = parsed.message?.content ?? parsed.response;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue(delta);
        return parsed.done === true;
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured Ollama done event',
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

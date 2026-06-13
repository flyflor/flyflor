import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderErrorShape } from '../types';

interface ChatCompletionChunk {
    error?: ProviderErrorShape;
    choices?: Array<{
        delta?: {
            content?: string;
        };
        finish_reason?: string | null;
    }>;
}

export const openAIChatCompletionsAdapter: ProtocolAdapter = {
    name: FModelProtocolName.OpenAIChatCompletions,
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        messages: context.messages,
        stream: true,
        max_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as ChatCompletionChunk;
        if (parsed.error !== undefined) throw Error(providerErrorMessage(parsed.error, 'LLM provider stream error'));
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue(delta);
        return typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

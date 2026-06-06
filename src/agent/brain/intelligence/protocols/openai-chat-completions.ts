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
    defaultPath: '/chat/completions',
    auth: 'bearer',
    usesV1Fallback: true,
    body: (context: ProtocolBuildContext) => ({
        model: context.resolvedModel,
        messages: context.request.messages,
        stream: true,
        max_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = parseJson<ChatCompletionChunk>(data);
        if (parsed.error !== undefined) throw Error(providerErrorMessage(parsed.error, 'LLM provider stream error'));
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) controller.enqueue(delta);
        return typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0;
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured finish_reason',
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

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

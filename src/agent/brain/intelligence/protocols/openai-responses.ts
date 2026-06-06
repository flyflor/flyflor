import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderErrorShape } from '../types';

interface ResponsesEvent {
    type?: string;
    delta?: string;
    error?: ProviderErrorShape;
    response?: {
        error?: ProviderErrorShape;
    };
    message?: string;
    code?: string;
}

export const openAIResponsesAdapter: ProtocolAdapter = {
    name: FModelProtocolName.OpenAIResponses,
    defaultPath: '/responses',
    auth: 'bearer',
    usesV1Fallback: true,
    body: (context: ProtocolBuildContext) => ({
        model: context.resolvedModel,
        input: context.request.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_output_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = parseJson<ResponsesEvent>(data);
        if (parsed.type === 'response.output_text.delta') {
            if (typeof parsed.delta === 'string' && parsed.delta.length > 0) controller.enqueue(parsed.delta);
            return false;
        }
        if (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') return true;
        if (parsed.type === 'response.failed' || parsed.type === 'error') {
            throw Error(providerErrorMessage(parsed.error ?? parsed.response?.error, 'LLM provider Responses stream error', parsed.message, parsed.code));
        }
        return false;
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured response terminal event',
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

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string, message?: string, code?: string): string {
    const resolvedMessage = message ?? error?.message ?? error?.type;
    const resolvedCode = code ?? error?.code;
    return [resolvedCode, resolvedMessage].filter(Boolean).join(': ') || fallback;
}

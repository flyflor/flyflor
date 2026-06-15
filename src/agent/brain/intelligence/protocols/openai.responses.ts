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
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        input: context.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_output_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as ResponsesEvent;
        if (parsed.type === 'response.output_text.delta') {
            if (typeof parsed.delta === 'string' && parsed.delta.length > 0) controller.enqueue({ type: 'text_delta', text: parsed.delta });
            return false;
        }
        if (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') {
            controller.enqueue({ type: 'done', stopReason: parsed.type === 'response.incomplete' ? 'length' : 'stop' });
            return true;
        }
        if (parsed.type === 'response.failed' || parsed.type === 'error') {
            throw Error(providerErrorMessage(parsed.error ?? parsed.response?.error, 'LLM provider Responses stream error', parsed.message, parsed.code));
        }
        return false;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string, message?: string, code?: string): string {
    const resolvedMessage = message ?? error?.message ?? error?.type;
    const resolvedCode = code ?? error?.code;
    return [resolvedCode, resolvedMessage].filter(Boolean).join(': ') || fallback;
}

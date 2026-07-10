import type { ProtocolAdapter, ProtocolContext, ProviderError } from './types';

interface ResponsesEvent {
    type?: string;
    delta?: string;
    error?: ProviderError;
    response?: { error?: ProviderError };
    message?: string;
    code?: string;
}

export const responsesAdapter: ProtocolAdapter = {
    name: 'responses',
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        input: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_output_tokens: context.config.maxTokens,
    }),
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as ResponsesEvent;
        if (parsed.type === 'response.output_text.delta') {
            if (parsed.delta) controller.enqueue({ type: 'text_delta', text: parsed.delta });
        } else if (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') {
            controller.enqueue({ type: 'done', stopReason: parsed.type === 'response.incomplete' ? 'length' : 'stop' });
            return true;
        } else if (parsed.type === 'response.failed' || parsed.type === 'error') {
            throw Error(errorMessage(parsed.error ?? parsed.response?.error, 'Responses stream error', parsed.message, parsed.code));
        }
        return false;
    },
};

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

function errorMessage(error: ProviderError | undefined, fallback: string, message?: string, code?: string): string {
    const resolvedMessage = message ?? error?.message ?? error?.type;
    const resolvedCode = code ?? error?.code;
    return [resolvedCode, resolvedMessage].filter(Boolean).join(': ') || fallback;
}

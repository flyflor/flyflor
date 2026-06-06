import { FModelProtocolName } from '@/config';
import { AgentChatRole, type AgentChatMessage, type ProtocolAdapter, type ProtocolBuildContext, type ProviderErrorShape } from '../types';

export const anthropicMessagesAdapter: ProtocolAdapter = {
    name: FModelProtocolName.AnthropicMessages,
    defaultPath: '/v1/messages',
    auth: 'anthropic',
    defaultVersion: '2023-06-01',
    body: (context: ProtocolBuildContext) => {
        const { system, messages } = anthropicMessages(context.request.messages);
        return {
            model: context.resolvedModel,
            messages,
            ...(system.length > 0 ? { system: system.join('\n\n') } : {}),
            stream: true,
            max_tokens: context.maxTokens,
        };
    },
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = parseJson<Record<string, unknown>>(data);
        const type = parsed.type;
        if (type === 'content_block_delta') {
            const delta = parsed.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) controller.enqueue(delta.text);
            return false;
        }
        if (type === 'message_delta') {
            const delta = parsed.delta as { stop_reason?: string } | undefined;
            return typeof delta?.stop_reason === 'string' && delta.stop_reason.length > 0;
        }
        if (type === 'message_stop') return true;
        if (type === 'error') throw Error(providerErrorMessage(parsed.error as ProviderErrorShape | undefined, 'Anthropic Messages stream error'));
        return false;
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured Anthropic terminal event',
};

function anthropicMessages(messages: AgentChatMessage[]): { system: string[]; messages: Array<{ role: string; content: string }> } {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: string }> = [];
    for (const message of messages) {
        if (message.role === AgentChatRole.System) {
            system.push(message.content);
            continue;
        }
        conversation.push({ role: message.role, content: message.content });
    }
    return { system, messages: conversation };
}

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

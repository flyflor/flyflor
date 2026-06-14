import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderErrorShape } from '../types';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';

export const anthropicMessagesAdapter: ProtocolAdapter = {
    name: FModelProtocolName.AnthropicMessages,
    body: (context: ProtocolBuildContext) => {
        const { system, messages } = anthropicMessages(context.messages);
        return {
            model: context.model,
            messages,
            ...(system.length > 0 ? { system: system.join('\n\n') } : {}),
            stream: true,
            max_tokens: context.maxTokens,
        };
    },
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
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
};

function anthropicMessages(messages: AgentMemory[]): { system: string[]; messages: Array<{ role: string; content: string }> } {
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

function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderErrorShape, ProviderMessage } from '../types';
import { AgentChatRole } from '@/agent/types';

/**
 * EN: Protocol adapter for the Anthropic Messages SSE wire format.
 * ZH: Anthropic Messages SSE 线协议适配器。
 */
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
            if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) controller.enqueue({ type: 'text_delta', text: delta.text });
            return false;
        }
        if (type === 'message_delta') {
            const delta = parsed.delta as { stop_reason?: string } | undefined;
            if (typeof delta?.stop_reason === 'string' && delta.stop_reason.length > 0) {
                controller.enqueue({ type: 'done', stopReason: delta.stop_reason === 'max_tokens' ? 'length' : 'stop' });
                return true;
            }
            return false;
        }
        if (type === 'message_stop') {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        }
        if (type === 'error') throw Error(providerErrorMessage(parsed.error as ProviderErrorShape | undefined, 'Anthropic Messages stream error'));
        return false;
    },
};

/**
 * EN: Splits provider-local messages into Anthropic system blocks and conversation turns.
 * ZH: 把 provider-local 消息拆分为 Anthropic system 块与对话回合。
 */
function anthropicMessages(messages: ProviderMessage[]): { system: string[]; messages: Array<{ role: string; content: string }> } {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: string }> = [];
    for (const message of messages) {
        if (message.role === 'action') continue;
        if (message.role === AgentChatRole.System) {
            system.push(message.content);
            continue;
        }
        conversation.push({ role: message.role, content: message.content });
    }
    return { system, messages: conversation };
}

/**
 * EN: Extracts the JSON payload from one SSE `data:` line.
 * ZH: 从一行 SSE `data:` 中提取 JSON 负载。
 */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

/**
 * EN: Formats a provider error payload into one readable message.
 * ZH: 把 provider 错误负载格式化为一条可读消息。
 */
function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string): string {
    return error?.code ? `${error.code}: ${error.message ?? error.type ?? fallback}` : error?.message ?? error?.type ?? fallback;
}

import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderMessage } from '../types';
import { ChatRole } from '@/neural/brain/types';

/**
 * EN: Protocol adapter for the AWS Bedrock Converse JSON-lines wire format.
 * ZH: AWS Bedrock Converse JSON 行线协议适配器。
 */
export const awsBedrockConverseAdapter: ProtocolAdapter = {
    name: FModelProtocolName.AWSBedrockConverse,
    body: (context: ProtocolBuildContext) => {
        const { system, messages } = bedrockMessages(context.messages);
        return {
            messages,
            ...(system.length > 0 ? { system: system.map((text) => ({ text })) } : {}),
            inferenceConfig: { maxTokens: context.maxTokens },
        };
    },
    parseLine: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (data.length === 0) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const contentBlockDelta = parsed.contentBlockDelta as { delta?: { text?: string } } | undefined;
        const text = contentBlockDelta?.delta?.text;
        if (typeof text === 'string' && text.length > 0) controller.enqueue({ type: 'text_delta', text });
        if (parsed.messageStop !== undefined || typeof (parsed.messageStop as { stopReason?: string } | undefined)?.stopReason === 'string') {
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        }
        return false;
    },
};

/**
 * EN: Splits provider-local messages into Bedrock system prompts and conversation turns.
 * ZH: 把 provider-local 消息拆分为 Bedrock system 提示与对话回合。
 */
function bedrockMessages(messages: ProviderMessage[]): {
    system: string[];
    messages: Array<{ role: string; content: Array<{ text: string }> }>;
} {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: Array<{ text: string }> }> = [];
    for (const message of messages) {
        if (message.role === 'action') continue;
        if (message.role === ChatRole.System) {
            system.push(message.content);
            continue;
        }
        conversation.push({
            role: message.role === ChatRole.Assistant ? 'assistant' : 'user',
            content: [{ text: message.content }],
        });
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

import { FModelProtocolName } from '@/config';
import { AgentChatRole, type AgentMemory, type ProtocolAdapter, type ProtocolBuildContext } from '../types';

export const awsBedrockConverseAdapter: ProtocolAdapter = {
    name: FModelProtocolName.AWSBedrockConverse,
    defaultPath: '/model/{model}/converse-stream',
    auth: 'bearer',
    acceptsJsonStream: true,
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
        const parsed = parseJson<Record<string, unknown>>(data);
        const contentBlockDelta = parsed.contentBlockDelta as { delta?: { text?: string } } | undefined;
        const text = contentBlockDelta?.delta?.text;
        if (typeof text === 'string' && text.length > 0) controller.enqueue(text);
        return parsed.messageStop !== undefined || typeof (parsed.messageStop as { stopReason?: string } | undefined)?.stopReason === 'string';
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured Bedrock messageStop event',
};

function bedrockMessages(messages: AgentMemory[]): {
    system: string[];
    messages: Array<{ role: string; content: Array<{ text: string }> }>;
} {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: Array<{ text: string }> }> = [];
    for (const message of messages) {
        if (message.role === AgentChatRole.System) {
            system.push(message.content);
            continue;
        }
        conversation.push({
            role: message.role === AgentChatRole.Assistant ? 'assistant' : 'user',
            content: [{ text: message.content }],
        });
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

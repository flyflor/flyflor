import type { Message } from '../types';
import type { ProtocolAdapter, ProtocolContext } from './types';

/**
 * ZH: AWS Bedrock converse-stream 适配器；纯文本，单独投影 system blocks。
 * EN: AWS Bedrock converse-stream adapter; text-only, projects system blocks separately.
 */
export const bedrockAdapter: ProtocolAdapter = {
    name: 'bedrock',
    tools: false,
    body: (context: ProtocolContext) => {
        const { system, messages } = project(context.messages);
        return {
            messages,
            ...(system.length > 0 ? { system: system.map((text) => ({ text })) } : {}),
            inferenceConfig: { maxTokens: context.config.maxTokens },
        };
    },
    parse: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (!data) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const text = (parsed.contentBlockDelta as { delta?: { text?: string } } | undefined)?.delta?.text;
        if (text) controller.enqueue({ type: 'text_delta', text });
        if (parsed.messageStop !== undefined) {
            const reason = (parsed.messageStop as { stopReason?: unknown }).stopReason;
            if (typeof reason !== 'string') throw Error('Bedrock stop reason is missing');
            controller.enqueue({ type: 'done', stopReason: terminal(reason) });
            return true;
        }
        return false;
    },
};

/** ZH: 将 Bedrock stopReason 映射为 StopReason。 EN: Maps Bedrock stopReason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' {
    if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
    if (reason === 'max_tokens') return 'length';
    throw Error(`Bedrock stop reason is unsupported: ${reason}`);
}

/** ZH: 将模型 Message 投影为 Bedrock system 与对话 blocks。 EN: Projects model Messages into Bedrock system and conversation blocks. */
function project(messages: Message[]): {
    system: string[];
    messages: Array<{ role: string; content: Array<{ text: string }> }>;
} {
    const system: string[] = [];
    const conversation: Array<{ role: string; content: Array<{ text: string }> }> = [];
    for (const message of messages) {
        if (message.role === 'tool') continue;
        if (message.role === 'system') system.push(message.content);
        else conversation.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: [{ text: message.content }] });
    }
    return { system, messages: conversation };
}

/** ZH: 有 SSE data 时提取负载；亦允许原始行。 EN: Extracts SSE data payload when present; raw lines remain allowed. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

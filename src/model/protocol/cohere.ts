import type { ProtocolAdapter, ProtocolContext } from './types';

/**
 * ZH: Cohere chat 流适配器；纯文本，在 message-end 或 finish_reason 时终态。
 * EN: Cohere chat stream adapter; text-only, terminates on message-end or finish_reason.
 */
export const cohereAdapter: ProtocolAdapter = {
    name: 'cohere',
    tools: false,
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        messages: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_tokens: context.config.maxTokens,
    }),
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const delta = parsed.delta as {
            finish_reason?: unknown;
            message?: { content?: { text?: string } | Array<{ text?: string }> };
        } | undefined;
        const content = delta?.message?.content;
        if (Array.isArray(content)) {
            for (const item of content) if (item.text) controller.enqueue({ type: 'text_delta', text: item.text });
        } else if (content?.text) {
            controller.enqueue({ type: 'text_delta', text: content.text });
        }
        if (parsed.type === 'message-end' || parsed.type === 'stream-end' || typeof parsed.finish_reason === 'string') {
            const reason = parsed.finish_reason ?? delta?.finish_reason;
            if (typeof reason !== 'string' || reason.length === 0) throw Error('Cohere finish reason is missing');
            controller.enqueue({ type: 'done', stopReason: terminal(reason) });
            return true;
        }
        return false;
    },
};

/** ZH: 将 Cohere finish_reason 映射为 StopReason。 EN: Maps Cohere finish_reason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' {
    const normalized = reason.toUpperCase();
    if (normalized === 'COMPLETE' || normalized === 'STOP') return 'stop';
    if (normalized === 'MAX_TOKENS' || normalized === 'LENGTH') return 'length';
    throw Error(`Cohere finish reason is unsupported: ${reason}`);
}

/** ZH: 提取 SSE data 负载；忽略非 data 行。 EN: Extracts SSE data payload; ignores non-data lines. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

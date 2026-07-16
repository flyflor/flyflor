import type { ProtocolAdapter, ProtocolContext } from './types';

/**
 * ZH: Ollama JSON 流适配器；纯文本，终态 chunk 必须带 done_reason。
 * EN: Ollama JSON stream adapter; text-only, requires done_reason on the terminal chunk.
 */
export const ollamaAdapter: ProtocolAdapter = {
    name: 'ollama',
    tools: false,
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        messages: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        options: { num_predict: context.config.maxTokens },
    }),
    parse: (controller, line) => {
        const data = sseData(line) ?? line.trim();
        if (!data) return false;
        const parsed = JSON.parse(data) as { message?: { content?: string }; response?: string; done?: boolean; done_reason?: string };
        const text = parsed.message?.content ?? parsed.response;
        if (text) controller.enqueue({ type: 'text_delta', text });
        if (parsed.done === true) {
            if (typeof parsed.done_reason !== 'string' || parsed.done_reason.length === 0) throw Error('Ollama done reason is missing');
            controller.enqueue({ type: 'done', stopReason: terminal(parsed.done_reason) });
            return true;
        }
        return false;
    },
};

/** ZH: 将 Ollama done_reason 映射为 StopReason。 EN: Maps Ollama done_reason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' {
    if (reason === 'stop') return 'stop';
    if (reason === 'length') return 'length';
    throw Error(`Ollama done reason is unsupported: ${reason}`);
}

/** ZH: 有 SSE data 时提取负载；亦允许原始 JSON 行。 EN: Extracts SSE data payload when present; raw JSON lines remain allowed. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

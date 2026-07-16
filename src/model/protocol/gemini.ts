import type { Message } from '../types';
import type { ProtocolAdapter, ProtocolContext } from './types';

/**
 * ZH: Gemini generateContent 流适配器；纯文本，单独投影 system_instruction。
 * EN: Gemini generateContent stream adapter; text-only, projects system_instruction separately.
 */
export const geminiAdapter: ProtocolAdapter = {
    name: 'gemini',
    tools: false,
    body: (context: ProtocolContext) => {
        const { contents, system } = project(context.messages);
        return {
            contents,
            ...(system ? { system_instruction: system } : {}),
            generationConfig: { maxOutputTokens: context.config.maxTokens },
        };
    },
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const blocked = (parsed.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason;
        if (blocked !== undefined) throw Error(`Gemini prompt was blocked: ${String(blocked)}`);
        const candidate = (parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined)?.[0];
        for (const part of candidate?.content?.parts ?? []) if (part.text) controller.enqueue({ type: 'text_delta', text: part.text });
        if (candidate?.finishReason) {
            controller.enqueue({ type: 'done', stopReason: terminal(candidate.finishReason) });
            return true;
        }
        return false;
    },
};

/** ZH: 将模型 Message 投影为 Gemini contents 与可选 system_instruction。 EN: Projects model Messages into Gemini contents and optional system_instruction. */
function project(messages: Message[]): {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    system?: { parts: Array<{ text: string }> };
} {
    const system: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const message of messages) {
        if (message.role === 'tool') continue;
        if (message.role === 'system') system.push(message.content);
        else contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
    }
    return { contents, ...(system.length > 0 ? { system: { parts: [{ text: system.join('\n\n') }] } } : {}) };
}

/** ZH: 将 Gemini finishReason 映射为 StopReason。 EN: Maps Gemini finishReason strings to StopReason. */
function terminal(reason: string): 'stop' | 'length' {
    if (reason === 'STOP') return 'stop';
    if (reason === 'MAX_TOKENS') return 'length';
    throw Error(`Gemini finish reason is unsupported: ${reason}`);
}

/** ZH: 提取 SSE data 负载；忽略非 data 行。 EN: Extracts SSE data payload; ignores non-data lines. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

import type { Message } from '../types';
import type { ProtocolAdapter, ProtocolContext } from './types';

export const geminiAdapter: ProtocolAdapter = {
    name: 'gemini',
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
        const candidate = (parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined)?.[0];
        for (const part of candidate?.content?.parts ?? []) if (part.text) controller.enqueue({ type: 'text_delta', text: part.text });
        if (candidate?.finishReason) {
            controller.enqueue({ type: 'done', stopReason: candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop' });
            return true;
        }
        return false;
    },
};

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

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

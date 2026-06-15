import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter, ProtocolBuildContext } from '../types';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';

export const googleGeminiGenerateContentAdapter: ProtocolAdapter = {
    name: FModelProtocolName.GoogleGeminiGenerateContent,
    body: (context: ProtocolBuildContext) => {
        const { contents, systemInstruction } = geminiRequest(context.messages);
        return {
            contents,
            ...(systemInstruction !== undefined ? { system_instruction: systemInstruction } : {}),
            generationConfig: { maxOutputTokens: context.maxTokens },
        };
    },
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined;
        const candidate = candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
            if (typeof part.text === 'string' && part.text.length > 0) controller.enqueue({ type: 'text_delta', text: part.text });
        }
        if (typeof candidate?.finishReason === 'string' && candidate.finishReason.length > 0) {
            controller.enqueue({ type: 'done', stopReason: candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop' });
            return true;
        }
        return false;
    },
};

function geminiRequest(messages: AgentMemory[]): {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    systemInstruction?: { parts: Array<{ text: string }> };
} {
    const system: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const message of messages) {
        if (message.role === AgentChatRole.System) {
            system.push(message.content);
            continue;
        }
        contents.push({
            role: message.role === AgentChatRole.Assistant ? 'model' : 'user',
            parts: [{ text: message.content }],
        });
    }
    return {
        contents,
        ...(system.length > 0 ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
    };
}

function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

import { FModelProtocolName } from '@/config';
import { AgentChatRole, type AgentChatMessage, type ProtocolAdapter, type ProtocolBuildContext } from '../types';

export const googleGeminiGenerateContentAdapter: ProtocolAdapter = {
    name: FModelProtocolName.GoogleGeminiGenerateContent,
    defaultPath: '/v1beta/models/{model}:streamGenerateContent?alt=sse',
    auth: 'google',
    body: (context: ProtocolBuildContext) => {
        const { contents, systemInstruction } = geminiRequest(context.request.messages);
        return {
            contents,
            ...(systemInstruction !== undefined ? { system_instruction: systemInstruction } : {}),
            generationConfig: { maxOutputTokens: context.maxTokens },
        };
    },
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = parseJson<Record<string, unknown>>(data);
        const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined;
        const candidate = candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
            if (typeof part.text === 'string' && part.text.length > 0) controller.enqueue(part.text);
        }
        return typeof candidate?.finishReason === 'string' && candidate.finishReason.length > 0;
    },
    missingTerminalMessage: () => 'LLM provider stream ended without a structured Gemini finishReason',
};

function geminiRequest(messages: AgentChatMessage[]): {
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

function parseJson<T>(data: string): T {
    try {
        return JSON.parse(data) as T;
    } catch (error) {
        throw Object.assign(Error('LLM provider returned non-JSON stream data'), {
            detail: { data, cause: error instanceof Error ? error.message : String(error) },
        });
    }
}

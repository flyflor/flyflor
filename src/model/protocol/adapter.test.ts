import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import type { StreamEvent } from '../types';
import { anthropicAdapter } from './anthropic';
import { bedrockAdapter } from './bedrock';
import { ProtocolClient } from './client';
import { cohereAdapter } from './cohere';
import { geminiAdapter } from './gemini';
import { ollamaAdapter } from './ollama';
import { openAIAdapter } from './openai';
import { responsesAdapter } from './responses';
import type { ProtocolAdapter, ProtocolState } from './types';

function parse(adapter: ProtocolAdapter, lines: string[]): StreamEvent[] {
    const events: StreamEvent[] = [];
    const state: ProtocolState = {
        buffer: '',
        finished: false,
        toolCallsByIndex: new Map(),
        toolCallsById: new Map(),
        nextToolIndex: 0,
    };
    const controller = {
        enqueue: (event: StreamEvent) => events.push(event),
        close: () => undefined,
        error: () => undefined,
        desiredSize: 1,
    } as unknown as ReadableStreamDefaultController<StreamEvent>;
    for (const line of lines) adapter.parse(controller, line, state);
    return events;
}

describe('provider adapters', () => {
    test('parses Anthropic events', () => {
        const events = parse(anthropicAdapter, [
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"a"}}',
            'data: {"type":"message_stop"}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'a' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Responses events', () => {
        const events = parse(responsesAdapter, [
            'data: {"type":"response.output_text.delta","delta":"r"}',
            'data: {"type":"response.completed"}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'r' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Gemini events', () => {
        const events = parse(geminiAdapter, ['data: {"candidates":[{"content":{"parts":[{"text":"g"}]},"finishReason":"STOP"}]}']);
        expect(events).toEqual([{ type: 'text_delta', text: 'g' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Bedrock events', () => {
        const events = parse(bedrockAdapter, [
            '{"contentBlockDelta":{"delta":{"text":"b"}}}',
            '{"messageStop":{"stopReason":"end_turn"}}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'b' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Cohere events', () => {
        const events = parse(cohereAdapter, [
            'data: {"type":"content-delta","delta":{"message":{"content":{"text":"c"}}}}',
            'data: {"type":"message-end"}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'c' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Ollama events', () => {
        const events = parse(ollamaAdapter, [
            '{"message":{"content":"o"},"done":false}',
            '{"done":true}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'o' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('maps only declared compatible providers to one OpenAI adapter', () => {
        const client = useContainer().create(ProtocolClient);
        expect(client.resolve('deepseek').adapter).toBe(openAIAdapter);
        expect(client.resolve('vllm').adapter).toBe(openAIAdapter);
        expect(client.resolve('lm-studio').adapter).toBe(openAIAdapter);
        expect(() => client.resolve('huggingface')).toThrow('Unsupported model provider');
    });

    test('rejects an oversized serialized request before fetch', async () => {
        const client = useContainer().create(ProtocolClient);
        const originalFetch = globalThis.fetch;
        let fetches = 0;
        globalThis.fetch = (async () => {
            fetches += 1;
            throw Error('fetch must not run');
        }) as unknown as typeof fetch;
        const reader = client.stream({
            provider: 'vllm',
            model: 'model',
            baseUrl: 'http://localhost',
            apiKeyEnv: '',
            timeoutSeconds: 60,
            contextLength: 1024 * 1024,
            maxTokens: 1024,
        }, [{ role: 'user', content: 'x'.repeat(600 * 1024) }], AbortSignal.timeout(1000)).getReader();

        try {
            await expect(reader.read()).rejects.toMatchObject({
                message: 'Model provider request body exceeds limit',
                detail: { maxRequestBytes: 512 * 1024 },
            });
            expect(fetches).toBe(0);
        } finally {
            reader.releaseLock();
            globalThis.fetch = originalFetch;
        }
    });
});

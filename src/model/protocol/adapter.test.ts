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
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
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
            'data: {"type":"message-end","delta":{"finish_reason":"COMPLETE"}}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'c' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('parses Ollama events', () => {
        const events = parse(ollamaAdapter, [
            '{"message":{"content":"o"},"done":false}',
            '{"done":true,"done_reason":"stop"}',
        ]);
        expect(events).toEqual([{ type: 'text_delta', text: 'o' }, { type: 'done', stopReason: 'stop' }]);
    });

    test('declares tools only for the implemented OpenAI-compatible protocol', () => {
        expect(openAIAdapter.tools).toBe(true);
        for (const adapter of [anthropicAdapter, responsesAdapter, geminiAdapter, bedrockAdapter, cohereAdapter, ollamaAdapter]) {
            expect(adapter.tools).toBe(false);
        }
    });

    test('rejects unsafe and unknown provider terminal reasons', () => {
        expect(() => parse(anthropicAdapter, ['data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}'])).toThrow('refusal');
        expect(() => parse(responsesAdapter, ['data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"content_filter"}}}'])).toThrow('content_filter');
        expect(() => parse(geminiAdapter, ['data: {"candidates":[{"finishReason":"SAFETY"}]}'])).toThrow('SAFETY');
        expect(() => parse(bedrockAdapter, ['{"messageStop":{"stopReason":"guardrail_intervened"}}'])).toThrow('guardrail_intervened');
        expect(() => parse(cohereAdapter, ['data: {"type":"message-end","delta":{"finish_reason":"ERROR_TOXIC"}}'])).toThrow('ERROR_TOXIC');
        expect(() => parse(ollamaAdapter, ['{"done":true,"done_reason":"unknown"}'])).toThrow('unknown');
        expect(() => parse(openAIAdapter, ['data: {"choices":[{"finish_reason":"content_filter"}]}'])).toThrow('content_filter');
    });

    test('rejects provider terminal markers that omit their reason', () => {
        expect(() => parse(anthropicAdapter, ['data: {"type":"message_stop"}'])).toThrow('without a stop reason');
        expect(() => parse(cohereAdapter, ['data: {"type":"message-end"}'])).toThrow('finish reason is missing');
        expect(() => parse(ollamaAdapter, ['{"done":true}'])).toThrow('done reason is missing');
        expect(() => parse(openAIAdapter, ['data: [DONE]'])).toThrow('without a finish reason');
    });

    test('parses strict Responses JSON terminals', () => {
        expect(responsesAdapter.parseJson?.({ status: 'completed', output_text: 'done' })).toEqual({ text: 'done', stopReason: 'stop' });
        expect(responsesAdapter.parseJson?.({
            status: 'incomplete',
            output_text: 'partial',
            incomplete_details: { reason: 'max_output_tokens' },
        })).toEqual({ text: 'partial', stopReason: 'length' });
        expect(() => responsesAdapter.parseJson?.({
            status: 'incomplete',
            incomplete_details: { reason: 'content_filter' },
        })).toThrow('content_filter');
        expect(() => responsesAdapter.parseJson?.({
            status: 'completed',
            output: [{ content: [{ refusal: 'cannot comply' }] }],
        })).toThrow('cannot comply');
        expect(() => responsesAdapter.parseJson?.({
            status: 'completed',
            output_text: 'unsafe partial text',
            output: [{ content: [{ refusal: 'still cannot comply' }] }],
        })).toThrow('still cannot comply');
        expect(() => parse(responsesAdapter, ['data: {"type":"response.completed","response":{"output":[{"content":[{"refusal":"stream refusal"}]}]}}'])).toThrow('stream refusal');
        expect(() => parse(openAIAdapter, ['data: {"choices":[{"delta":{"refusal":"policy refusal"}}]}'])).toThrow('policy refusal');
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

    test('rejects unsupported tool definitions and replay before fetch', async () => {
        const client = useContainer().create(ProtocolClient);
        const originalFetch = globalThis.fetch;
        let fetches = 0;
        globalThis.fetch = (async () => {
            fetches += 1;
            throw Error('fetch must not run');
        }) as unknown as typeof fetch;
        const config = {
            provider: 'anthropic',
            model: 'model',
            baseUrl: 'http://localhost',
            apiKeyEnv: '',
            timeoutSeconds: 60,
            contextLength: 4096,
            maxTokens: 1024,
        } as const;
        const requests = [
            {
                messages: [{ role: 'user' as const, content: 'use a tool' }],
                tools: [{ name: 'filesystem', description: 'read', parameters: { type: 'object' } }],
            },
            {
                messages: [{
                    role: 'assistant' as const,
                    content: '',
                    toolCalls: [{ id: 'call_1', name: 'filesystem', arguments: { action: 'read' } }],
                }],
                tools: undefined,
            },
        ];

        try {
            for (const request of requests) {
                const reader = client.stream(config, request.messages, AbortSignal.timeout(1000), request.tools).getReader();
                await expect(reader.read()).rejects.toThrow('Model protocol does not support tools: anthropic');
                reader.releaseLock();
            }
            expect(fetches).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('keeps unsupported-tool protocols available for ordinary text history', async () => {
        const client = useContainer().create(ProtocolClient);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response([
            '{"message":{"content":"text reply"},"done":false}',
            '{"done":true,"done_reason":"stop"}',
            '',
        ].join('\n'), { headers: { 'content-type': 'application/x-ndjson' } })) as unknown as typeof fetch;
        const reader = client.stream({
            provider: 'ollama',
            model: 'model',
            baseUrl: 'http://localhost',
            apiKeyEnv: '',
            timeoutSeconds: 60,
            contextLength: 4096,
            maxTokens: 1024,
        }, [
            { role: 'assistant', content: 'previous text', toolCalls: [] },
            { role: 'user', content: 'continue' },
        ], AbortSignal.timeout(1000)).getReader();
        const events: StreamEvent[] = [];

        try {
            while (true) {
                const event = await reader.read();
                if (event.done) break;
                events.push(event.value);
            }
        } finally {
            reader.releaseLock();
            globalThis.fetch = originalFetch;
        }

        expect(events).toEqual([
            { type: 'text_delta', text: 'text reply' },
            { type: 'done', stopReason: 'stop' },
        ]);
    });
});

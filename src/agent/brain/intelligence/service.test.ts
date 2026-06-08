import { afterEach, describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { FModelProtocolName, type FModelConfiguration } from '@/config';
import { AgentChatRole, type AgentMemory } from './types';
import { Intelligence } from './service';

const TEST_API_KEY_ENV = 'FLYFLOR_INTELLIGENCE_TEST_API_KEY';
const originalFetch = globalThis.fetch;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env[TEST_API_KEY_ENV];
});

describe('Intelligence', () => {
    test('streams JSON deltas until a structured finish reason', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        let url = '';
        let requestBody: { stream?: boolean; max_tokens?: number } | undefined;
        globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
            url = String(input);
            requestBody = JSON.parse(String(init?.body));
            return new Response(bodyFromText('data: {"choices":[{"delta":{"content":"he"},"finish_reason":null}]}\n\n', 'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":null}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).resolves.toBe('hello');
        expect(url).toBe('https://example.test/chat/completions');
        expect(requestBody).toMatchObject({ stream: true, max_tokens: 64 });
    });

    test('tries a v1 endpoint when the configured base URL omitted it', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const urls: string[] = [];
        globalThis.fetch = (async (input: FetchInput) => {
            const url = String(input);
            urls.push(url);
            if (url !== 'https://example.test/v1/chat/completions') {
                return new Response('missing', { status: 404 });
            }
            return new Response(bodyFromText('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).resolves.toBe('ok');
        expect(urls).toEqual(['https://example.test/chat/completions', 'https://example.test/v1/chat/completions']);
    });

    test('reuses one Intelligence instance across turns with explicit turn messages', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const seenMessages: Array<Array<{ role: string; content: string }>> = [];
        globalThis.fetch = (async (_input: FetchInput, init?: FetchInit) => {
            const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
            seenMessages.push(body.messages ?? []);
            const last = seenMessages.at(-1)?.at(0)?.content ?? 'missing';
            return new Response(bodyFromText(`data: {"choices":[{"delta":{"content":"${last}"},"finish_reason":null}]}\n\n`, 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages([{ role: AgentChatRole.User, content: 'first' }]))).resolves.toBe('first');
        expect(intelligence.complete(messages([{ role: AgentChatRole.User, content: 'second' }]))).resolves.toBe('second');
        expect(seenMessages).toEqual([[{ role: AgentChatRole.User, content: 'first' }], [{ role: AgentChatRole.User, content: 'second' }]]);
    });

    test('uses Responses streaming when chat-completions protocol is unavailable', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const urls: string[] = [];
        let responsesBody: { input?: Array<{ role: string; content: string }>; max_output_tokens?: number } | undefined;
        globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
            const url = String(input);
            urls.push(url);
            if (!url.endsWith('/responses')) {
                return new Response('missing', { status: 404 });
            }
            responsesBody = JSON.parse(String(init?.body));
            return new Response(bodyFromText('event: response.output_text.delta\n', 'data: {"type":"response.output_text.delta","delta":"res"}\n\n', 'event: response.output_text.delta\n', 'data: {"type":"response.output_text.delta","delta":"ponse"}\n\n', 'event: response.completed\n', 'data: {"type":"response.completed","response":{"id":"resp-test"}}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).resolves.toBe('response');
        expect(urls).toEqual(['https://example.test/chat/completions', 'https://example.test/v1/chat/completions', 'https://example.test/responses']);
        expect(responsesBody).toMatchObject({
            input: [{ role: AgentChatRole.User, content: 'hello' }],
            max_output_tokens: 64,
        });
    });

    test('uses Responses streaming when chat-completions returns non-streaming JSON', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const urls: string[] = [];
        globalThis.fetch = (async (input: FetchInput) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith('/chat/completions')) {
                return Response.json({ choices: [{ message: { content: 'full json' } }] });
            }
            return new Response(bodyFromText('data: {"type":"response.output_text.delta","delta":"stream"}\n\n', 'data: {"type":"response.completed","response":{"id":"resp-test"}}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).resolves.toBe('stream');
        expect(urls).toEqual(['https://example.test/chat/completions', 'https://example.test/responses']);
    });

    test('uses Responses JSON when Responses does not stream', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return Response.json({ output_text: 'json answer' });
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://example.test', [{ name: FModelProtocolName.OpenAIResponses }]));

        expect(intelligence.complete(messages())).resolves.toBe('json answer');
    });

    test('does not duplicate v1 when the configured base URL already includes it', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const urls: string[] = [];
        globalThis.fetch = (async (input: FetchInput) => {
            urls.push(String(input));
            return new Response(bodyFromText('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://example.test/v1'));

        expect(intelligence.complete(messages())).resolves.toBe('ok');
        expect(urls).toEqual(['https://example.test/v1/chat/completions']);
    });

    test('respects configured protocol order', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const urls: string[] = [];
        globalThis.fetch = (async (input: FetchInput) => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith('/chat/completions')) {
                return new Response('missing', { status: 404 });
            }
            return new Response(bodyFromText('data: {"type":"response.output_text.delta","delta":"ok"}\n\n', 'data: {"type":"response.completed","response":{"id":"resp-test"}}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://example.test', [{ name: FModelProtocolName.OpenAIResponses }, { name: FModelProtocolName.OpenAIChatCompletions }]));

        expect(intelligence.complete(messages())).resolves.toBe('ok');
        expect(urls).toEqual(['https://example.test/responses']);
    });

    test('supports ollama structured done events', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return new Response(bodyFromText('{"message":{"content":"hello"},"done":false}\n', '{"message":{"content":" world"},"done":false}\n', '{"done":true}\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('http://127.0.0.1:11434', [{ name: FModelProtocolName.Ollama }]));

        expect(intelligence.complete(messages())).resolves.toBe('hello world');
    });

    test('supports anthropic message stop events', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return new Response(bodyFromText('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n', 'data: {"type":"message_stop"}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://api.anthropic.com', [{ name: FModelProtocolName.AnthropicMessages }]));

        expect(intelligence.complete(messages())).resolves.toBe('hi');
    });

    test('includes the system prompt in Gemini system_instruction', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        let requestBody: Record<string, unknown> | undefined;
        globalThis.fetch = (async (_input: FetchInput, init?: FetchInit) => {
            requestBody = JSON.parse(String(init?.body));
            return new Response(bodyFromText('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n'));
        }) as unknown as typeof fetch;

        const input = [
            { role: AgentChatRole.System, content: 'follow the constitution' },
            { role: AgentChatRole.User, content: 'hello' },
        ];
        const intelligence = await useIntelligence(modelConfiguration('https://generativelanguage.googleapis.com', [{ name: FModelProtocolName.GoogleGeminiGenerateContent }]));

        expect(intelligence.complete(input)).resolves.toBe('ok');
        expect(requestBody).toMatchObject({
            system_instruction: { parts: [{ text: 'follow the constitution' }] },
            contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
        });
    });

    test('accepts Bedrock JSON streaming responses and sends bearer auth', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        let authorization = '';
        globalThis.fetch = (async (_input: FetchInput, init?: FetchInit) => {
            authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '');
            return new Response(bodyFromText('{"contentBlockDelta":{"delta":{"text":"bed"}}}\n', '{"contentBlockDelta":{"delta":{"text":"rock"}}}\n', '{"messageStop":{"stopReason":"end_turn"}}\n'), {
                headers: { 'content-type': 'application/json' },
            });
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://bedrock-runtime.us-east-1.amazonaws.com', [{ name: FModelProtocolName.AWSBedrockConverse }]));

        expect(intelligence.complete(messages())).resolves.toBe('bedrock');
        expect(authorization).toBe('Bearer test-key');
    });

    test('errors when the stream ends without a structured finish reason', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return new Response(bodyFromText('data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).rejects.toThrow('structured finish_reason');
    });

    test('errors on non-JSON stream data', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return new Response(bodyFromText('data: not-json\n\n'));
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();

        expect(intelligence.complete(messages())).rejects.toThrow('non-JSON stream data');
    });

    test('errors when Responses JSON has no text', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        globalThis.fetch = (async () => {
            return Response.json({ id: 'resp-test' });
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence(modelConfiguration('https://example.test', [{ name: FModelProtocolName.OpenAIResponses }]));

        expect(intelligence.complete(messages())).rejects.toThrow('Responses JSON did not include text');
    });

    test('aborts the current request through Intelligence cancel', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        let aborted = false;
        globalThis.fetch = (async (_input: FetchInput, init?: FetchInit) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => {
                aborted = true;
            });
            return new Response(new ReadableStream());
        }) as unknown as typeof fetch;

        const intelligence = await useIntelligence();
        const reader = intelligence.reader(messages());
        const reason = Error('cancelled by test');
        intelligence.cancel(reason);

        expect(reader.read()).rejects.toThrow();
        expect(aborted).toBe(true);
    });

    test('errors when no turn messages were published', async () => {
        process.env[TEST_API_KEY_ENV] = 'test-key';
        const intelligence = await useIntelligence();

        expect(intelligence.complete([])).rejects.toThrow('messages are missing');
    });
});

async function useIntelligence(llm = modelConfiguration()): Promise<Intelligence> {
    const intelligence = await useContainer().getAsync(Intelligence);
    intelligence.config = { model: llm } as unknown as FModelConfiguration;
    return intelligence;
}

function messages(input: AgentMemory[] = [{ role: AgentChatRole.User, content: 'hello' }]): AgentMemory[] {
    return input;
}

function modelConfiguration(baseUrl = 'https://example.test', protocols = [{ name: FModelProtocolName.OpenAIChatCompletions }, { name: FModelProtocolName.OpenAIResponses }]): FModelConfiguration {
    return {
        default: 'test-model',
        model: 'test-model',
        provider: 'test-provider',
        apiKeyEnv: TEST_API_KEY_ENV,
        baseUrl,
        protocols,
        entra: {},
        contextLength: 1024,
        maxTokens: 64,
    };
}

function bodyFromText(...chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
}

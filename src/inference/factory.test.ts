import { afterEach, describe, expect, test } from 'bun:test';
import type { FModelConfiguration } from '@/configuration';
import { FModelProtocolName } from '@/configuration';
import { AgentChatRole } from '@/agent';
import { createInferenceRequestStream } from './factory';

const originalFetch = globalThis.fetch;

const config: FModelConfiguration = {
    default: 'model',
    model: 'model',
    provider: 'test',
    apiKeyEnv: '',
    baseUrl: 'https://example.invalid',
    protocols: [{
        name: FModelProtocolName.OpenAIChatCompletions,
        path: '/chat/completions',
        auth: 'none',
        missingTerminalMessage: 'missing terminal',
    }],
    entra: {},
    contextLength: 32000,
    maxTokens: 1000,
};

const messages = [{ role: AgentChatRole.User, content: 'hello' }];

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('createInferenceRequestStream', () => {
    test('propagates an external abort reason to a pending provider request', async () => {
        globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        })) as typeof fetch;
        const controller = new AbortController();
        const reader = createInferenceRequestStream(config, messages, controller.signal, undefined, {
            requestTimeoutMs: 1000,
            staleTimeoutMs: 1000,
        }).getReader();

        controller.abort(Error('obsolete revision'));

        await expect(reader.read()).rejects.toThrow('obsolete revision');
    });

    test('terminates a provider request at its total deadline', async () => {
        globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        })) as typeof fetch;
        const reader = createInferenceRequestStream(config, messages, new AbortController().signal, undefined, {
            requestTimeoutMs: 10,
            staleTimeoutMs: 1000,
        }).getReader();

        await expect(reader.read()).rejects.toThrow('Inference request timed out');
    });

    test('cancels a response reader that stops producing stream activity', async () => {
        let cancelled = false;
        globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true;
            },
        }), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
        const reader = createInferenceRequestStream(config, messages, new AbortController().signal, undefined, {
            requestTimeoutMs: 1000,
            staleTimeoutMs: 10,
        }).getReader();

        await expect(reader.read()).rejects.toThrow('Inference provider stream became stale');
        expect(cancelled).toBe(true);
    });

    test('propagates consumer cancellation to the active response reader', async () => {
        let markReading!: () => void;
        const reading = new Promise<void>((resolve) => { markReading = resolve; });
        let cancelled: unknown;
        globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
            pull() {
                markReading();
                return new Promise(() => undefined);
            },
            cancel(reason) {
                cancelled = reason;
            },
        }), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
        const reader = createInferenceRequestStream(config, messages, new AbortController().signal, undefined, {
            requestTimeoutMs: 1000,
            staleTimeoutMs: 1000,
        }).getReader();
        await reading;
        const reason = Error('consumer stopped');

        await reader.cancel(reason);
        await Bun.sleep(0);

        expect(cancelled).toBe(reason);
    });
});

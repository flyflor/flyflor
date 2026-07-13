import { describe, expect, test } from 'bun:test';
import type { Message, StreamEvent } from '../types';
import { openAIAdapter } from './openai';
import type { ProtocolState } from './types';

function state(): ProtocolState {
    return {
        buffer: '',
        finished: false,
        toolCallsByIndex: new Map(),
        toolCallsById: new Map(),
        nextToolIndex: 0,
    };
}

describe('openAIAdapter', () => {
    test('normalizes streamed tool calls', () => {
        const stream = state();
        const events: StreamEvent[] = [];
        const controller = {
            enqueue: (event: StreamEvent) => events.push(event),
            close: () => undefined,
            error: () => undefined,
            desiredSize: 1,
        } as unknown as ReadableStreamDefaultController<StreamEvent>;

        openAIAdapter.parse(
            controller,
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"filesystem","arguments":"{\\"action\\":\\"read\\"}"}}]}}]}',
            stream,
        );
        const finished = openAIAdapter.parse(controller, 'data: {"choices":[{"finish_reason":"tool_calls"}]}', stream);

        expect(finished).toBe(true);
        const end = events.find((event) => event.type === 'tool_end');
        expect(end && 'call' in end ? end.call : undefined).toEqual({
            id: 'call_1',
            name: 'filesystem',
            arguments: { action: 'read' },
        });
    });

    test('projects tool replay without polluting agent memory', () => {
        const messages: Message[] = [
            { role: 'system', content: 'system' },
            {
                role: 'assistant',
                content: '我先读文件',
                reasoning: '需要读取',
                toolCalls: [{ id: 'call_1', name: 'filesystem', arguments: { action: 'read' } }],
            },
            {
                role: 'tool',
                toolCallId: 'call_1',
                content: '{"content":"read"}',
            },
        ];
        const body = openAIAdapter.body({
            config: {
                provider: 'openai',
                model: 'gpt',
                baseUrl: '',
                apiKeyEnv: '',
                timeoutSeconds: 60,
                contextLength: 1024,
                maxTokens: 256,
            },
            messages,
            spec: { name: 'openai', path: '/v1/chat/completions', auth: 'none' },
            adapter: openAIAdapter,
            tools: [],
        });
        const bodyJson = JSON.stringify(body);

        expect(bodyJson).toContain('"tool_calls"');
        expect(bodyJson).toContain('"role":"tool"');
        expect(bodyJson).not.toContain('toolCalls');
    });

    test('rejects malformed streamed tool arguments', () => {
        const stream = state();
        const controller = {
            enqueue: () => undefined,
            close: () => undefined,
            error: () => undefined,
            desiredSize: 1,
        } as unknown as ReadableStreamDefaultController<StreamEvent>;
        openAIAdapter.parse(
            controller,
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bad","function":{"name":"filesystem","arguments":"{bad"}}]}}]}',
            stream,
        );

        expect(() => openAIAdapter.parse(controller, 'data: {"choices":[{"finish_reason":"tool_calls"}]}', stream)).toThrow();
    });
});

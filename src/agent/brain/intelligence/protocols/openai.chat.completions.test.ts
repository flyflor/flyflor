import { describe, expect, test } from 'bun:test';
import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { createProtocolStreamState } from '../factory';
import type { IntelligenceEvent, ProviderMessage } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

describe('openAIChatCompletionsAdapter', () => {
    test('normalizes streamed tool_calls into action events', () => {
        const state = createProtocolStreamState();
        const events: IntelligenceEvent[] = [];
        const controller = {
            enqueue: (event: IntelligenceEvent) => events.push(event),
            close: () => undefined,
            error: () => undefined,
            desiredSize: 1,
        } as unknown as ReadableStreamDefaultController<IntelligenceEvent>;

        openAIChatCompletionsAdapter.parseLine(
            controller,
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"filesystem","arguments":"{\\"action\\":\\"read\\"}"}}]}}]}',
            state,
        );
        const finished = openAIChatCompletionsAdapter.parseLine(
            controller,
            'data: {"choices":[{"finish_reason":"tool_calls"}]}',
            state,
        );

        expect(finished).toBe(true);
        expect(events.map((event) => event.type)).toContain('action_end');
        const actionEnd = events.find((event) => event.type === 'action_end');
        expect(actionEnd && 'request' in actionEnd ? actionEnd.request : undefined).toEqual({
            id: 'call_1',
            name: 'filesystem',
            arguments: { action: 'read' },
        });
    });

    test('projects provider replay locally without polluting AgentMemory', () => {
        const messages: ProviderMessage[] = [
            { role: AgentChatRole.System, content: 'system' } satisfies AgentMemory,
            {
                role: AgentChatRole.Assistant,
                content: '我先读文件',
                reasoning: '需要读取',
                actionRequests: [{ id: 'call_1', name: 'filesystem', arguments: { action: 'read' } }],
            },
            {
                role: 'action',
                actionRequestId: 'call_1',
                actionName: 'filesystem',
                content: '{"ok":true}',
                isError: false,
            },
        ];

        const body = openAIChatCompletionsAdapter.body({
            config: { provider: 'openai', model: 'gpt', default: 'gpt', baseUrl: '', maxTokens: 256, contextLength: 0, apiKeyEnv: '', protocols: [], entra: {} },
            messages,
            protocol: { name: 'openai.chat.completions' as never, path: '/v1/chat/completions', enabled: true, auth: 'none' },
            adapter: openAIChatCompletionsAdapter,
            model: 'gpt',
            maxTokens: 256,
            tools: [],
        });
        const bodyJson = JSON.stringify(body);

        expect(bodyJson).toContain('"tool_calls"');
        expect(bodyJson).toContain('"role":"tool"');
        expect(bodyJson).not.toContain('toolCalls');
    });
});

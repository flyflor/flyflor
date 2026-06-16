import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import type { IntelligenceTurn } from '../intelligence/service';
import type { AgentToolCall } from '@/agent/memory';
import { Research, type ResearchSignal } from './service';

function turn(text: string, toolCalls: AgentToolCall[] = []): IntelligenceTurn {
    return { text, reasoning: '', toolCalls, stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop' };
}

describe('Research', () => {
    test('does not stream intermediate tool-call text as the user-visible answer', async () => {
        const research = await useContainer().getAsync(Research);
        const calls: AgentMemory[][] = [];
        const toolCall: AgentToolCall = { id: 'call_1', name: 'codegraph', arguments: { query: 'Research' } };
        const turns = [
            turn('I will inspect the project first.', [toolCall]),
            turn('The answer is based on summarized evidence.'),
        ];
        research.intelligence = {
            runTurn: async (messages: AgentMemory[]) => {
                calls.push(messages);
                const next = turns.shift();
                if (next === undefined) throw Error('unexpected model call');
                return next;
            },
        } as never;
        research.registry = {
            resetArtifacts: () => undefined,
            definitions: () => [{ name: 'codegraph', description: 'search', parameters: { type: 'object', properties: {} } }],
            dispatch: async () => ({
                content: 'evidence summary only',
                isError: false,
                preview: {
                    toolCallId: 'call_1',
                    name: 'codegraph',
                    kind: 'preview',
                    status: 'ok',
                    summary: 'one match',
                    preview: 'one match',
                    bytes: 9,
                    truncated: false,
                },
            }),
        } as never;

        const signals: ResearchSignal[] = [];
        const outcome = await research.run([
            { role: AgentChatRole.User, content: '研究一下项目结构' },
        ], (signal) => signals.push(signal));

        expect(outcome.answer).toBe('The answer is based on summarized evidence.');
        expect(signals.filter((signal) => signal.type === 'reply')).toEqual([
            { type: 'reply', chunk: 'The answer is based on summarized evidence.' },
        ]);
        expect(calls[0]?.[0]).toEqual({
            role: AgentChatRole.System,
            content: expect.stringContaining('Tools are evidence samplers'),
        });
    });
});

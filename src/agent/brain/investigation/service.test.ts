import { beforeEach, describe, expect, test } from 'bun:test';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { Context, ContextIntent, ContextTurnStatus } from '@/neural/context';
import { SynapseSignalType } from '@/neural/synapse';
import type { IntelligenceToolDefinition } from '../intelligence/types';
import { CallosumSignalType } from '../callosum';
import { Investigation } from './service';

function investigation(context: Context, turns: Array<{ text: string; toolCalls: any[] }>) {
    const events: Array<{ type: SynapseSignalType; data: unknown }> = [];
    const instance = new Investigation(
        { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 },
        { emit: (type: SynapseSignalType, data: unknown) => { events.push({ type, data }); } } as never,
    );
    let index = 0;
    instance.context = context;
    instance.tools = {
        list: () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }] as IntelligenceToolDefinition[],
        run: async (call: { name: string }) => call.name === 'ask'
            ? { ok: true, name: 'ask', data: { kind: 'ask', question: 'Pick?', options: ['a'] } }
            : { ok: true, name: call.name, data: { value: 'tool result' } },
    } as never;
    instance.intelligence = {
        streamTurn: async (_messages: AgentMemory[], _tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void) => {
            const turn = turns[index++]!;
            if (turn.toolCalls.length === 0) onText(turn.text);
            return { text: turn.text, reasoning: '', toolCalls: turn.toolCalls, stopReason: 'stop' };
        },
    } as never;
    return { instance, events };
}

describe('Investigation', () => {
    let context: Context;

    beforeEach(() => {
        context = new Context();
        context.current = undefined;
        context.working = [];
        context.turns = [];
        context.completed = [];
        context.pending = undefined;
        context.load({
            userText: '调查工具层',
            intent: ContextIntent.Research,
            goal: '调查工具层',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
    });

    test('returns final answer when the model does not request tools', async () => {
        const { instance, events } = investigation(context, [{ text: '直接答案', toolCalls: [] }]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '直接答案', completed: true, paused: false, steps: 1 });
        expect(events).toContainEqual({ type: SynapseSignalType.Reply, data: '直接答案' });
    });

    test('records tool call and tool result before the final answer', async () => {
        const { instance, events } = investigation(context, [
            { text: '我先读文件', toolCalls: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', toolCalls: [] },
        ]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '综合答案', completed: true, paused: false, steps: 2 });
        expect(context.working).toHaveLength(2);
        expect(context.turns[0]?.transcript).toContainEqual({
            role: AgentChatRole.Assistant,
            content: '我先读文件',
            reasoning: '',
            toolCalls: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }],
        });
        expect(context.turns[0]?.transcript.at(-1)?.role).toBe(AgentChatRole.Tool);
        expect(events.map((event) => event.type)).toContain(SynapseSignalType.Event);
    });

    test('pauses ask tool calls into typed context state', async () => {
        const { instance, events } = investigation(context, [
            { text: '需要确认', toolCalls: [{ id: 'tool_1', name: 'ask', arguments: { question: 'Pick?', options: ['a'] } }] },
        ]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ completed: false, paused: true, steps: 1 });
        expect(context.pending?.kind).toBe('ask');
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Paused);
        expect(events).toContainEqual({
            type: SynapseSignalType.Ask,
            data: { kind: 'ask', question: 'Pick?', options: ['a'] },
        });
    });
});

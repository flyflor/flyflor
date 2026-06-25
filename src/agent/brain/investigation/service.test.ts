import { beforeEach, describe, expect, test } from 'bun:test';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { Context, ContextIntent } from '@/neural/context';
import { SynapseSignalType } from '@/neural/synapse';
import type { ActionRequest } from '@/plugins/tools';
import type { IntelligenceToolDefinition, ProviderMessage } from '../intelligence/types';
import { CallosumSignalType } from '../callosum';
import { Investigation } from './service';

function investigation(context: Context, turns: Array<{ text: string; actionRequests: ActionRequest[] }>) {
    const events: Array<{ type: SynapseSignalType; data: unknown }> = [];
    const seenMessages: ProviderMessage[][] = [];
    const instance = new Investigation(
        { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 },
        { emit: (type: SynapseSignalType, data: unknown) => { events.push({ type, data }); } } as never,
    );
    let index = 0;
    instance.context = context;
    instance.tools = {
        list: () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }, { name: 'ask', description: 'ask', parameters: {} }] as IntelligenceToolDefinition[],
        run: async (call: ActionRequest) => call.name === 'ask'
            ? { ok: true, name: 'ask', data: { kind: 'ask', question: 'Pick?', options: ['a'] } }
            : { ok: true, name: call.name, data: { action: 'read', path: '/tmp/demo.ts', value: 'tool result' } },
    } as never;
    instance.intelligence = {
        streamTurn: async (messages: ProviderMessage[], _tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void) => {
            seenMessages.push(messages.map((message) => ({ ...message } as ProviderMessage)));
            const turn = turns[index++]!;
            if (turn.actionRequests.length === 0) onText(turn.text);
            return { text: turn.text, reasoning: '', actionRequests: turn.actionRequests, stopReason: 'stop' };
        },
    } as never;
    return { instance, events, seenMessages };
}

describe('Investigation', () => {
    let context: Context;

    beforeEach(() => {
        context = new Context();
        context.current = undefined;
        context.turns = [];
        context.completed = [];
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

    test('returns final answer when the model does not request actions', async () => {
        const { instance, events } = investigation(context, [{ text: '直接答案', actionRequests: [] }]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '直接答案', completed: true, paused: false, steps: 1, evidence: [] });
        expect(events).toContainEqual({ type: SynapseSignalType.Reply, data: '直接答案' });
    });

    test('replays actions only inside the local provider buffer and returns evidence strings', async () => {
        const { instance, events, seenMessages } = investigation(context, [
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '综合答案', completed: true, paused: false, steps: 2 });
        expect(outcome.evidence).toEqual(['filesystem read /tmp/demo.ts ok']);
        expect(events.map((event) => event.type)).toContain(SynapseSignalType.Event);
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
        expect(JSON.stringify(context.turns)).not.toContain('"role":"tool"');
        expect(seenMessages).toHaveLength(2);
        expect(seenMessages[1]?.some((message) => message.role === 'action')).toBe(true);
    });

    test('ask action emits ask and pause signals without writing pending state into context', async () => {
        const { instance, events } = investigation(context, [
            { text: '需要确认', actionRequests: [{ id: 'tool_1', name: 'ask', arguments: { question: 'Pick?', options: ['a'] } }] },
        ]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ completed: false, paused: true, steps: 1 });
        expect(events).toContainEqual({
            type: SynapseSignalType.Ask,
            data: { kind: 'ask', question: 'Pick?', options: ['a'] },
        });
        expect(events.some((event) => event.type === SynapseSignalType.Pause)).toBe(true);
        expect(JSON.stringify(context)).not.toContain('pending');
    });

    test('separate runs do not leak the previous action buffer', async () => {
        const first = investigation(context, [
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);
        await first.instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        const second = investigation(context, [{ text: '第二次答案', actionRequests: [] }]);
        await second.instance.run(
            { type: CallosumSignalType.Research, chunk: '再次调查工具层' },
            [{ role: AgentChatRole.User, content: '再次调查工具层' }],
        );

        expect(second.seenMessages).toHaveLength(1);
        expect(second.seenMessages[0]?.some((message) => message.role === 'action')).toBe(false);
    });
});

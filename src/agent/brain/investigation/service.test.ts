import { beforeEach, describe, expect, test } from 'bun:test';
import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { Context } from '@/agent/context';
import { SynapseSignalType } from '@/neural/types';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceToolDefinition, ProviderMessage } from '../intelligence/types';
import { CallosumSignalType } from '../callosum';
import { Investigation } from './service';

/**
 * EN: investigation function declaration.
 * ZH: investigation function 声明。
 */
function investigation(context: Context, responses: Array<{ text: string; actionRequests: ActionRequest[] }>) {
    const events: Array<{ type: SynapseSignalType; data: unknown }> = [];
    const seenMessages: ProviderMessage[][] = [];
    const calls: ActionRequest[] = [];
    const instance = new Investigation(
        { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 },
        { emit: (type: SynapseSignalType, data: unknown) => { events.push({ type, data }); } } as never,
    );
    let index = 0;
    instance.context = context;
    instance.tools = {
        list: async () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }, { name: 'ask', description: 'ask', parameters: {} }] as IntelligenceToolDefinition[],
        run: async (call: ActionRequest) => {
            calls.push(call);
            return call.name === 'ask'
                ? { ok: true, name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }
                : { ok: true, name: call.name, data: { action: 'read', path: '/tmp/demo.ts', value: 'tool result' } };
        },
    } as never;
    instance.intelligence = {
        streamRequest: async (messages: ProviderMessage[], _tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void) => {
            seenMessages.push(messages.map((message) => ({ ...message } as ProviderMessage)));
            const response = responses[index++]!;
            if (response.actionRequests.length === 0) onText(response.text);
            return { text: response.text, reasoning: '', actionRequests: response.actionRequests, stopReason: 'stop' };
        },
    } as never;
    return { instance, events, seenMessages, calls };
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
            intent: 'research',
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
        context.current!.workingDirectory = '/tmp/semantic';
        const { instance, events, seenMessages, calls } = investigation(context, [
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
        const replay = seenMessages[1]?.find((message) => message.role === AgentChatRole.Assistant && 'actionRequests' in message);
        expect(calls[0]?.arguments).toMatchObject({ cwd: '/tmp/semantic' });
        expect(replay && 'actionRequests' in replay ? replay.actionRequests[0]?.arguments : undefined).toMatchObject({ cwd: '/tmp/semantic' });
    });

    test('does not override explicit tool cwd', async () => {
        context.current!.workingDirectory = '/tmp/semantic';
        const { instance, calls } = investigation(context, [
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read', cwd: '/tmp/explicit' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(calls[0]?.arguments.cwd).toBe('/tmp/explicit');
    });

    test('does not inject cwd when current turn has no workingDirectory', async () => {
        const { instance, calls } = investigation(context, [
            { text: '我先跑 shell', actionRequests: [{ id: 'tool_1', name: 'shell', arguments: { command: 'pwd' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect('cwd' in calls[0]!.arguments).toBe(false);
    });

    test('injects workingDirectory into execute and shell requests without cwd', async () => {
        context.current!.workingDirectory = '/tmp/semantic';
        const { instance, calls } = investigation(context, [
            {
                text: '跑工具',
                actionRequests: [
                    { id: 'tool_1', name: 'execute', arguments: { tasks: [{ runtime: 'sh', path: 'a.sh' }] } },
                    { id: 'tool_2', name: 'shell', arguments: { command: 'pwd' } },
                ],
            },
            { text: '综合答案', actionRequests: [] },
        ]);

        await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(calls.map((call) => call.arguments.cwd)).toEqual(['/tmp/semantic', '/tmp/semantic']);
    });

    test('ask action emits ask and pause signals while storing only pause semantics in context', async () => {
        const { instance, events } = investigation(context, [
            { text: '需要确认', actionRequests: [{ id: 'tool_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }] },
        ]);

        const outcome = await instance.run(
            { type: CallosumSignalType.Research, chunk: '调查工具层' },
            [{ role: AgentChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ completed: false, paused: true, steps: 1 });
        expect(events).toContainEqual({
            type: SynapseSignalType.Ask,
            data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] },
        });
        expect(events.some((event) => event.type === SynapseSignalType.Pause)).toBe(true);
        expect(context.turns[0]?.paused).toBe(true);
        expect(context.turns[0]?.pauseKind).toBe('ask');
        expect(context.turns[0]?.pausePrompt).toBe('Pick?');
        expect(JSON.stringify(context)).not.toContain('pending');
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
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

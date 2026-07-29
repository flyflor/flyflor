import { beforeEach, describe, expect, test } from 'bun:test';
import { ChatRole, type MemoryMessage } from '@/neural/brain/types';
import { Context } from '@/neural/context';
import { SynapseSignalType } from '@/neural/types';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceToolDefinition, ProviderMessage } from '../intelligence/types';
import { Investigation } from './service';

/**
 * ponytail: this test never writes a turn fixture by hand. The latest user
 * message is plain prose; cwd / constraint lists / references are all left
 * to the LLM mock that the prod path already calls. `cwd` injection in
 * `Investigation.withWorkingDirectory` is asserted by calling it through the
 * real control flow with a request whose arguments omit `cwd`.
 */

function mockInvestigation(context: Context, responses: Array<{ text: string; actionRequests: ActionRequest[] }>) {
    const events: Array<{ type: SynapseSignalType; data: unknown }> = [];
    const seenMessages: ProviderMessage[][] = [];
    const calls: ActionRequest[] = [];
    const instance = new Investigation(
        {
            emit: (type: SynapseSignalType, data: unknown) => { events.push({ type, data }); },
            interact: async (request: { turnId: string; id: string; kind: 'ask' | 'confirm'; data: unknown }) => {
                context.pause(request.turnId, { id: request.id, kind: request.kind, prompt: JSON.stringify(request.data) });
                events.push({ type: request.kind === 'ask' ? SynapseSignalType.Ask : SynapseSignalType.Confirm, data: request.data });
                context.resume(request.turnId, request.id);
                return request.kind === 'ask'
                    ? { kind: 'ask', answers: [{ question: 'Pick?', answer: 'a' }] }
                    : { kind: 'confirm', approved: true };
            },
        } as never,
    );
    let index = 0;
    instance.context = context;
    instance.tools = {
        list: async () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }, { name: 'ask', description: 'ask', parameters: {} }] as IntelligenceToolDefinition[],
        cwd: async (name: string) => name !== 'ask',
        requiresConfirm: async () => false,
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

function ingestMock() {
    return {
        completeText: async (messages: Array<{ role: string; content: string }>) => {
            const user = messages.find((m) => m.role === 'user')?.content ?? '';
            return JSON.stringify({
                intent: 'research',
                goal: user,
                cwd: '/tmp/semantic',
                constraints: [],
                refs: [],
                done: [],
                open: [],
                investigate: true,
            });
        },
    };
}

describe('Investigation', () => {
    let context: Context;

    beforeEach(async () => {
        context = new Context();
        context.prompt = { section: () => 'system placeholder' } as never;
        context.intelligence = ingestMock() as never;
        await context.ingest({ text: '调查工具层 cwd=/tmp/semantic', speakerId: 'test' });
    });

    test('returns a final answer when the local loop ends without further action requests', async () => {
        const { instance, events } = mockInvestigation(context, [{ text: '直接答案', actionRequests: [] }]);

        const outcome = await instance.run(
            [{ role: ChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '直接答案', completed: true, paused: false, steps: 1, evidence: [] });
        expect(events).toContainEqual({ type: SynapseSignalType.Reply, data: { turnId: undefined, chunk: '直接答案' } });
    });

    test('can finish silently for worker and reviewer runs', async () => {
        const { instance, events } = mockInvestigation(context, [{ text: '静默答案', actionRequests: [] }]);

        const outcome = await instance.run(
            [{ role: ChatRole.User, content: '调查工具层' }],
            { emitReply: false },
        );

        expect(outcome.answer).toBe('静默答案');
        expect(events.some((event) => event.type === SynapseSignalType.Reply)).toBe(false);
    });

    test('streams text, replays the local action buffer into the next request, and emits one evidence line', async () => {
        const { instance, events, seenMessages, calls } = mockInvestigation(context, [
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        const outcome = await instance.run(
            [{ role: ChatRole.User, content: '调查工具层' }],
        );

        expect(outcome).toMatchObject({ answer: '综合答案', completed: true, paused: false, steps: 2 });
        expect(outcome.evidence.join('\n')).toContain('filesystem');
        expect(outcome.evidence.join('\n')).toContain('/tmp/demo.ts');
        expect(events.map((event) => event.type)).toContain(SynapseSignalType.Event);
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
        expect(JSON.stringify(context.turns)).not.toContain('"role":"tool"');
        expect(seenMessages).toHaveLength(2);
        expect(seenMessages[1]?.some((message) => message.role === 'action')).toBe(true);
        expect(JSON.stringify(seenMessages)).toContain('filesystem');
    });

    test('leaves an explicit cwd alone when the tool already carries one', async () => {
        const { instance, calls } = mockInvestigation(context, [
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read', cwd: '/tmp/explicit' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        await instance.run(
            [{ role: ChatRole.User, content: '调查工具层' }],
        );

        expect(calls[0]?.arguments.cwd).toBe('/tmp/explicit');
    });

    test('injects the active turn cwd into shell and execute requests that do not carry one', async () => {
        const cwd = '/tmp/semantic';
        const turn = context.working()!;
        const { instance, calls } = mockInvestigation(context, [
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
            [{ role: ChatRole.User, content: '调查工具层' }],
            { cwd: turn.cwd },
        );

        expect(calls.map((call) => call.arguments.cwd)).toEqual([cwd, cwd]);
    });

    test('ask action resumes the same investigation with a structured answer', async () => {
        const { instance, events, seenMessages } = mockInvestigation(context, [
            { text: '需要确认', actionRequests: [{ id: 'tool_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }] },
            { text: '继续完成', actionRequests: [] },
        ]);

        const turn = context.working()!;
        const outcome = await instance.run(
            [{ role: ChatRole.User, content: '调查工具层' }],
            { turnId: turn.id, cwd: turn.cwd },
        );
        expect(outcome).toMatchObject({ answer: '继续完成', completed: true, paused: false, steps: 2 });
        expect(events).toContainEqual({
            type: SynapseSignalType.Ask,
            data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] },
        });
        expect(JSON.stringify(seenMessages.at(-1))).toContain('\\"kind\\":\\"ask\\"');
        expect(JSON.stringify(context.turns)).not.toContain('"pause"');
        expect(JSON.stringify(context)).not.toContain('pending');
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
    });
});

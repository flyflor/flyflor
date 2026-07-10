import { describe, expect, test } from 'bun:test';
import { AgentChatRole } from '@/agent/types';
import { SynapseSignalType } from '@/neural/types';
import type { ActionRequest } from '@/plugins';
import type { IntelligenceToolDefinition, ProviderMessage } from '../intelligence/types';
import { Investigation } from './service';

interface HarnessOptions {
    confirm?: boolean;
    interaction?: boolean;
}

function harness(responses: Array<{ text: string; actionRequests: ActionRequest[] }>, options: HarnessOptions = {}) {
    const events: Array<{ type: string; data: unknown }> = [];
    const seenMessages: ProviderMessage[][] = [];
    const calls: ActionRequest[] = [];
    const bus = {
        emit: (type: string, data: unknown) => events.push({ type, data }),
        interact: options.interaction === false
            ? undefined
            : async (request: { kind: 'ask' | 'confirm' }) => request.kind === 'ask'
                ? { kind: 'ask', answers: [{ question: 'Pick?', answer: 'a' }] }
                : { kind: 'confirm', approved: true },
    };
    const instance = new Investigation(
        { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 },
        bus as never,
    );
    let index = 0;
    instance.tools = {
        list: async () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }, { name: 'ask', description: 'ask', parameters: {} }] as IntelligenceToolDefinition[],
        cwd: async (name: string) => name !== 'ask',
        requiresConfirm: async () => options.confirm === true,
        run: async (call: ActionRequest) => {
            calls.push(call);
            return call.name === 'ask'
                ? { ok: true, name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }
                : { ok: true, name: call.name, data: { action: 'read', path: '/tmp/demo.ts' } };
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

const messages = [{ role: AgentChatRole.User, content: '调查工具层' }];

describe('Investigation', () => {
    test('returns and streams a final answer', async () => {
        const { instance, events } = harness([{ text: '直接答案', actionRequests: [] }]);

        const outcome = await instance.run(messages);

        expect(outcome).toMatchObject({ answer: '直接答案', completed: true, paused: false, steps: 1, evidence: [] });
        expect(events).toContainEqual({ type: SynapseSignalType.Reply, data: '直接答案' });
    });

    test('can finish silently for coordinated work', async () => {
        const { instance, events } = harness([{ text: '静默答案', actionRequests: [] }]);

        const outcome = await instance.run(messages, { emitReply: false });

        expect(outcome.answer).toBe('静默答案');
        expect(events.some((event) => event.type === SynapseSignalType.Reply)).toBe(false);
    });

    test('replays tool requests and results without leaking them into turn state', async () => {
        const { instance, events, seenMessages, calls } = harness([
            { text: '我先读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', actionRequests: [] },
        ]);

        const outcome = await instance.run(messages, { cwd: '/tmp/semantic' });

        expect(outcome).toMatchObject({ answer: '综合答案', steps: 2, evidence: ['filesystem read /tmp/demo.ts ok'] });
        expect(calls[0]?.arguments.cwd).toBe('/tmp/semantic');
        expect(events.some((event) => event.type === SynapseSignalType.Event)).toBe(true);
        expect(seenMessages[1]?.some((message) => message.role === 'action')).toBe(true);
    });

    test('keeps an explicit tool cwd', async () => {
        const { instance, calls } = harness([
            { text: '读文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read', cwd: '/tmp/explicit' } }] },
            { text: '完成', actionRequests: [] },
        ]);

        await instance.run(messages, { cwd: '/tmp/semantic' });

        expect(calls[0]?.arguments.cwd).toBe('/tmp/explicit');
    });

    test('continues after a structured ask answer', async () => {
        const { instance, seenMessages } = harness([
            { text: '需要回答', actionRequests: [{ id: 'tool_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }] },
            { text: '继续完成', actionRequests: [] },
        ]);

        const outcome = await instance.run(messages, { turnId: 'turn_1' });

        expect(outcome).toMatchObject({ answer: '继续完成', paused: false, steps: 2 });
        expect(JSON.stringify(seenMessages.at(-1))).toContain('\\"kind\\":\\"ask\\"');
    });

    test('denies approval-gated tools for non-interactive workers', async () => {
        const { instance, calls, seenMessages } = harness([
            { text: '写文件', actionRequests: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'write', path: 'a.ts' } }] },
            { text: '无法执行写入', actionRequests: [] },
        ], { confirm: true, interaction: false });

        const outcome = await instance.run(messages, { emitReply: false });

        expect(outcome.answer).toBe('无法执行写入');
        expect(calls).toHaveLength(0);
        expect(JSON.stringify(seenMessages.at(-1))).toContain('TOOL_APPROVAL_REQUIRED');
    });
});

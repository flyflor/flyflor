import { describe, expect, test } from 'bun:test';
import { AgentChatRole, AgentSignal } from '@/agent/types';
import { useContainer } from '@/core';
import type { Message, ToolCall, ToolDefinition } from '@/model';
import { Investigation } from './service';

interface HarnessOptions {
    confirm?: boolean;
    interaction?: boolean;
}

function harness(responses: Array<{ text: string; toolCalls: ToolCall[] }>, options: HarnessOptions = {}) {
    const events: Array<{ type: string; data: unknown }> = [];
    const seenMessages: Message[][] = [];
    const calls: ToolCall[] = [];
    const bus = {
        emit: (type: string, data: unknown) => events.push({ type, data }),
        interact: options.interaction === false
            ? undefined
            : async (request: { kind: 'ask' | 'confirm' }) => request.kind === 'ask'
                ? { kind: 'ask', answers: [{ question: 'Pick?', answer: 'a' }] }
                : { kind: 'confirm', approved: true },
    };
    const instance = useContainer().create(
        Investigation,
        { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 },
        bus as never,
    );
    let index = 0;
    instance.tools = {
        list: async () => [{ name: 'filesystem', description: 'filesystem', parameters: {} }, { name: 'ask', description: 'ask', parameters: {} }] as ToolDefinition[],
        cwd: async (name: string) => name !== 'ask',
        requiresConfirm: async () => options.confirm === true,
        run: async (call: ToolCall) => {
            calls.push(call);
            return call.name === 'ask'
                ? { ok: true, name: 'ask', data: { kind: 'ask', questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }
                : { ok: true, name: call.name, data: { action: 'read', path: '/tmp/demo.ts' } };
        },
    } as never;
    instance.model = {
        streamRun: async (messages: Message[], _tools: ToolDefinition[] | undefined, onText: (chunk: string) => void) => {
            seenMessages.push(messages.map((message) => ({ ...message } as Message)));
            const response = responses[index++]!;
            if (response.toolCalls.length === 0) onText(response.text);
            return { text: response.text, reasoning: '', toolCalls: response.toolCalls, stopReason: 'stop' };
        },
    } as never;
    return { instance, events, seenMessages, calls };
}

const messages = [{ role: AgentChatRole.User, content: '调查工具层' }];

describe('Investigation', () => {
    test('returns and streams a final answer', async () => {
        const { instance, events } = harness([{ text: '直接答案', toolCalls: [] }]);

        const outcome = await instance.run(messages);

        expect(outcome).toMatchObject({ answer: '直接答案', completed: true, paused: false, steps: 1, evidence: [] });
        expect(events).toContainEqual({ type: AgentSignal.Reply, data: '直接答案' });
    });

    test('can finish silently for coordinated work', async () => {
        const { instance, events } = harness([{ text: '静默答案', toolCalls: [] }]);

        const outcome = await instance.run(messages, { emitReply: false });

        expect(outcome.answer).toBe('静默答案');
        expect(events.some((event) => event.type === AgentSignal.Reply)).toBe(false);
    });

    test('replays tool requests and results without leaking them into turn state', async () => {
        const { instance, events, seenMessages, calls } = harness([
            { text: '我先读文件', toolCalls: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read' } }] },
            { text: '综合答案', toolCalls: [] },
        ]);

        const outcome = await instance.run(messages, { cwd: '/tmp/semantic' });

        expect(outcome).toMatchObject({ answer: '综合答案', steps: 2, evidence: ['filesystem read /tmp/demo.ts ok'] });
        expect(calls[0]?.arguments.cwd).toBe('/tmp/semantic');
        expect(events.some((event) => event.type === AgentSignal.Event)).toBe(true);
        expect(seenMessages[1]?.some((message) => message.role === 'tool')).toBe(true);
    });

    test('keeps an explicit tool cwd', async () => {
        const { instance, calls } = harness([
            { text: '读文件', toolCalls: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'read', cwd: '/tmp/explicit' } }] },
            { text: '完成', toolCalls: [] },
        ]);

        await instance.run(messages, { cwd: '/tmp/semantic' });

        expect(calls[0]?.arguments.cwd).toBe('/tmp/explicit');
    });

    test('continues after a structured ask answer', async () => {
        const { instance, seenMessages } = harness([
            { text: '需要回答', toolCalls: [{ id: 'tool_1', name: 'ask', arguments: { questions: [{ question: 'Pick?', options: [{ label: 'a' }] }] } }] },
            { text: '继续完成', toolCalls: [] },
        ]);

        const outcome = await instance.run(messages, { turnId: 'turn_1' });

        expect(outcome).toMatchObject({ answer: '继续完成', paused: false, steps: 2 });
        expect(JSON.stringify(seenMessages.at(-1))).toContain('\\"kind\\":\\"ask\\"');
    });

    test('denies approval-gated tools for non-interactive workers', async () => {
        const { instance, calls, seenMessages } = harness([
            { text: '写文件', toolCalls: [{ id: 'tool_1', name: 'filesystem', arguments: { action: 'write', path: 'a.ts' } }] },
            { text: '无法执行写入', toolCalls: [] },
        ], { confirm: true, interaction: false });

        const outcome = await instance.run(messages, { emitReply: false });

        expect(outcome.answer).toBe('无法执行写入');
        expect(calls).toHaveLength(0);
        expect(JSON.stringify(seenMessages.at(-1))).toContain('TOOL_APPROVAL_REQUIRED');
    });
});

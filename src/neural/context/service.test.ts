import { beforeEach, describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole } from '@/agent/memory';
import { Context, ContextIntent, ContextTurnStatus } from '@/neural/context';
import { CallosumSignalType } from '@/agent/brain';

describe('Context', () => {
    let context: Context;

    beforeEach(async () => {
        context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.working = [];
        context.turns = [];
        context.completed = [];
        context.pending = undefined;
    });

    test('ingest loads distilled turn understanding into agent memory', async () => {
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: '修复 IPC JSON 解析错误',
                constraints: ['以后用中文交流'],
                references: [{ type: 'error', value: 'Bad control character in string literal' }],
                knownDone: ['已经加过日志'],
                openQuestions: [],
                shouldInvestigate: true,
            }),
        } as never;

        const understanding = await context.ingest({ content: '解析错误: Bad control character in string literal' });

        expect(understanding.intent).toBe(ContextIntent.Research);
        expect(context.current?.goal).toBe('修复 IPC JSON 解析错误');
        expect(context.current?.references).toContainEqual({ type: 'error', value: 'Bad control character in string literal' });
        expect(context.turns).toHaveLength(1);
        expect(context.turns[0]?.transcript).toContainEqual({ role: AgentChatRole.User, content: '解析错误: Bad control character in string literal' });
    });

    test('work keeps original transcript while settle writes completed index', async () => {
        context.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '实现 context/memory 重构',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.work([{ role: AgentChatRole.Tool, content: 'changed src/neural/context/service.ts', toolCallId: 'tool_1', toolName: 'read_file', isError: false }]);
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: '实现 context/memory 重构',
                result: '已将 synapse.context 接入 agent.memory',
                changedFiles: ['src/neural/synapse.ts'],
                decisions: ['不引入额外 context pipeline'],
                evidence: ['agent.memory.completed 写入完成态'],
                remaining: [],
            }),
        } as never;

        context.work({ role: AgentChatRole.Assistant, content: '已完成' });
        const summary = await context.settle({
            user: '实现计划',
            assistant: '已完成',
            completed: true,
        });

        expect(summary?.result).toContain('synapse.context');
        expect(context.completed).toHaveLength(1);
        expect(context.working).toEqual([]);
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Completed);
        expect(context.turns[0]?.transcript).toContainEqual({ role: AgentChatRole.Assistant, content: '已完成' });
    });

    test('settle keeps working log for unfinished turn', async () => {
        context.work({ role: AgentChatRole.Assistant, content: '需要确认' });

        const summary = await context.settle({
            user: '实现计划',
            assistant: '需要确认',
            completed: false,
        });

        expect(summary).toBeUndefined();
        expect(context.working).toHaveLength(1);
    });

    test('pause stores typed pending state and resumes into the same turn', async () => {
        context.load({
            userText: '继续调查',
            intent: ContextIntent.Research,
            goal: '确认实现方式',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.pause({
            kind: 'ask',
            signal: { type: CallosumSignalType.Research, chunk: '继续调查' },
            data: { kind: 'ask', question: '选哪个?', options: ['a'] },
            messages: [{ role: AgentChatRole.User, content: '继续调查' }],
        });
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: '确认实现方式',
                constraints: [],
                references: [],
                knownDone: [],
                openQuestions: [],
                shouldInvestigate: true,
            }),
        } as never;

        await context.ingest({ content: '选 a' });
        const pending = context.consumePending();

        expect(pending?.kind).toBe('ask');
        expect(context.pending).toBeUndefined();
        expect(context.turns).toHaveLength(1);
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Working);
        expect(context.turns[0]?.transcript.at(-1)?.content).toContain('选 a');
        expect(pending?.messages.at(-1)?.content).toContain('选 a');
    });
});

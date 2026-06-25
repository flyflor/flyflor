import { beforeEach, describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Context, ContextIntent, ContextTurnStatus } from '@/neural/context';

describe('Context', () => {
    let context: Context;

    beforeEach(async () => {
        context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.turns = [];
        context.completed = [];
    });

    test('ingest creates a distilled turn understanding', async () => {
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
        expect(context.turns[0]?.understanding.userText).toBe('解析错误: Bad control character in string literal');
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Working);
    });

    test('settle creates a completed summary and stores it on the active turn', async () => {
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

        const summary = await context.settle({
            user: '实现计划',
            assistant: '已完成',
            completed: true,
            evidence: ['agent.memory.completed 写入完成态'],
        });

        expect(summary?.result).toContain('synapse.context');
        expect(context.completed).toHaveLength(1);
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Completed);
        expect(context.turns[0]?.summary?.result).toContain('synapse.context');
    });

    test('settle with completed false does not create a summary', async () => {
        context.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '确认实现方式',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });

        const summary = await context.settle({
            user: '实现计划',
            assistant: '需要确认',
            completed: false,
        });

        expect(summary).toBeUndefined();
        expect(context.completed).toHaveLength(0);
        expect(context.turns[0]?.summary).toBeUndefined();
        expect(context.turns[0]?.status).toBe(ContextTurnStatus.Working);
    });

    test('recent exposes only turn understanding and summaries', async () => {
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
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: '调查工具层',
                result: '工具层已经分离',
                changedFiles: ['src/plugins/tools/service.ts'],
                decisions: ['动作层不依赖 memory'],
                evidence: ['service.test.ts 通过'],
                remaining: [],
            }),
        } as never;
        await context.settle({ user: '调查工具层', assistant: '工具层已经分离', completed: true });

        const recent = context.recent();

        expect(recent).toHaveLength(1);
        expect(recent[0]?.understanding.goal).toBe('调查工具层');
        expect(recent[0]?.summary?.result).toBe('工具层已经分离');
        expect(JSON.stringify(recent[0])).not.toContain('transcript');
        expect(JSON.stringify(recent[0])).not.toContain('tool_call_id');
    });
});

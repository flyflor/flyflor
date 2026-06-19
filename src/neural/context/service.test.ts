import { beforeEach, describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole } from '@/agent/memory';
import { Context, ContextIntent } from '@/neural/context';

describe('Context', () => {
    let context: Context;

    beforeEach(async () => {
        context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.working = [];
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
    });

    test('settle writes completed state and clears working log', async () => {
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

        const summary = await context.settle({
            user: '实现计划',
            assistant: '已完成',
            completed: true,
        });

        expect(summary?.result).toContain('synapse.context');
        expect(context.completed).toHaveLength(1);
        expect(context.working).toEqual([]);
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
});

import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, Memory } from '@/agent/memory';
import { Context, ContextIntent } from '@/neural/context';

describe('Context', () => {
    test('ingest loads distilled turn understanding into agent memory', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        const context = await useContainer().getAsync(Context);
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

        const understanding = await context.ingest(memory, { content: '解析错误: Bad control character in string literal' });

        expect(understanding.intent).toBe(ContextIntent.Research);
        expect(memory.current?.goal).toBe('修复 IPC JSON 解析错误');
        expect(memory.current?.references).toContainEqual({ type: 'error', value: 'Bad control character in string literal' });
    });

    test('settle writes completed state and clears working log', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        const context = await useContainer().getAsync(Context);
        memory.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '实现 context/memory 重构',
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        memory.recordWork([{ role: AgentChatRole.Tool, content: 'changed src/neural/context/service.ts', toolCallId: 'tool_1', toolName: 'read_file', isError: false }]);
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

        const summary = await context.settle(memory, {
            user: '实现计划',
            assistant: '已完成',
            completed: true,
            working: memory.working,
        });

        expect(summary?.result).toContain('synapse.context');
        expect(memory.completed).toHaveLength(1);
        expect(memory.working).toEqual([]);
    });
});

import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Memory } from './memory';
import { ContextIntent } from '@/neural/context';

describe('Memory', () => {
    test('buildMessage renders current understanding and completed work instead of raw infinite history', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        memory.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '实现 synapse.context + agent.memory',
            constraints: ['不要过度抽象'],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        memory.rememberCompletion({
            goal: '修复 IPC',
            result: 'socket 背压写队列已完成',
            changedFiles: ['src/neural/ipc/socket.ts'],
            decisions: ['packet 保持 8-byte header'],
            evidence: [],
            remaining: [],
            createdAt: Date.now(),
        });

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';

        expect(system).toContain('<agent_memory>');
        expect(system).toContain('实现 synapse.context + agent.memory');
        expect(system).toContain('socket 背压写队列已完成');
        expect(user).toContain('"goal":"实现 synapse.context + agent.memory"');
        expect(user).toContain('"user":"实现计划"');
    });
});

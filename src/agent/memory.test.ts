import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Memory } from './memory';
import { AgentChatRole } from './memory';
import { Context, ContextIntent } from '@/neural/context';

describe('Memory', () => {
    test('buildMessage renders current understanding and completed work instead of raw infinite history', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        const context = await useContainer().getAsync(Context);
        context.current = undefined;
        context.working = [];
        context.turns = [];
        context.completed = [];
        context.load({
            userText: '实现计划',
            intent: ContextIntent.Research,
            goal: '实现 synapse.context + agent.memory',
            constraints: ['不要过度抽象'],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: true,
        });
        context.done({
            goal: '修复 IPC',
            result: 'socket 背压写队列已完成',
            changedFiles: ['src/neural/ipc/socket.ts'],
            decisions: ['packet 保持 8-byte header'],
            evidence: ['socket.test.ts 通过'],
            remaining: ['补集成验证'],
            createdAt: Date.now(),
        });
        context.work({ role: AgentChatRole.Assistant, content: '读取了 context service' });

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';

        expect(system).toContain('<agent_memory>');
        expect(system).toContain('实现 synapse.context + agent.memory');
        expect(system).toContain('socket 背压写队列已完成');
        expect(system).toContain('packet 保持 8-byte header');
        expect(system).toContain('socket.test.ts 通过');
        expect(user).toContain('"goal":"实现 synapse.context + agent.memory"');
        expect(user).toContain('"user":"实现计划"');
        expect(user).toContain('读取了 context service');
        expect(user).toContain('补集成验证');
    });
});

import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, Memory, type AgentMemory } from './memory';
import { Context, ContextIntent } from '@/neural/context';

describe('Memory', () => {
    test('keeps AgentMemory pure and renders summaries instead of transcripts or action replay', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
        const context = await useContainer().getAsync(Context);
        context.current = undefined;
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

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: AgentMemory['role'] = AgentChatRole.User;

        expect(role).toBe(AgentChatRole.User);
        expect(system).toContain('<agent_memory>');
        expect(system).toContain('实现 synapse.context + agent.memory');
        expect(system).toContain('socket 背压写队列已完成');
        expect(system).toContain('packet 保持 8-byte header');
        expect(system).toContain('socket.test.ts 通过');
        expect(user).toContain('"goal":"实现 synapse.context + agent.memory"');
        expect(user).toContain('"user":"实现计划"');
        expect(user).toContain('补集成验证');
        expect(user).not.toContain('toolCalls');
        expect(user).not.toContain('tool_call_id');
        expect(user).not.toContain('toolName');
        expect(user).not.toContain('"role":"tool"');
        expect(user).not.toContain('pending');
        expect(user).not.toContain('transcript');
    });
});

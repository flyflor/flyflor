import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { ChatRole, Memory, type MemoryMessage } from './memory';
import { Context } from '@/neural/context';

/**
 * EN: Memory is no longer a pure projection of Context.turns. It is a private
 * working-memory cache seeded by an explicit Context brief. The test verifies
 * that brief-derived notes (not the raw conversation) surface in the next model
 * call and that no tool replay buffers leak in.
 * ZH: Memory 不再是 Context.turns 的纯投影。它是由显式 Context 简报初始化的
 * 私有工作记忆缓存。本测试验证简报衍生的笔记（而非原始对话）出现在下一次模型
 * 调用中，且没有工具回放缓冲区泄漏。
 */
describe('Memory', () => {
    test('surfaces brief-derived notes without leaking tool or transcript buffers', async () => {
        const memory = await useContainer().getAsync(Memory);
        const context = new Context();
        context.prompt = { section: () => 'system placeholder' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: 'ship the synapse changes',
                cwd: '/tmp/flyflor',
                constraints: [],
                refs: [],
                done: [],
                open: [],
                investigate: true,
            }),
        } as never;

        const userMessage = '实现计划';
        const turn = await context.ingest({ text: userMessage, speakerId: 'test' });

        // EN: Seed the private working-memory cache from the Context brief.
        // ZH: 用 Context 简报初始化私有工作记忆缓存。
        memory.ingestBrief(context.brief());

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: MemoryMessage['role'] = ChatRole.User;

        expect(role).toBe(ChatRole.User);
        expect(system).not.toContain('<agent_memory>');
        expect(turn.goal).toContain('synapse');
        expect(turn.intent).toBe('research');
        expect(user).toContain('synapse');
        expect(user).toContain('research');
        expect(user).not.toContain(userMessage);
        expect(user).not.toContain('toolCalls');
        expect(user).not.toContain('tool_call_id');
        expect(user).not.toContain('toolName');
        expect(user).not.toContain('"role":"tool"');
        expect(user).not.toContain('pending');
        expect(user).not.toContain('transcript');
    });

    test('renders persona sections and brief notes from the configured package', async () => {
        const memory = await useContainer().getAsync(Memory);
        memory.config = { persona: {} } as never;
        memory.prompt = { render: () => 'system persona' } as never;

        memory.ingestBrief({
            turnId: 'turn_1',
            intent: 'research',
            goal: 'inspect one slice',
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [],
        });

        const messages = memory.buildMessage();

        expect(messages[0]?.content).toBe('system persona');
        expect(messages[1]?.content).toBe(`-[brief] turn turn_1: intent=research, goal=inspect one slice, constraints=[]`);
    });
});

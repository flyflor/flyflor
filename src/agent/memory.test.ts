import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, Memory, type AgentMemory } from './memory';
import { Context } from '@/agent/context';

/**
 * EN: Memory is no longer a pure projection of Context.turns. It is a private
 * agent cache seeded by an explicit Context brief. The test verifies that
 * brief-derived notes (not the raw conversation) surface in the next model call
 * and that no tool replay buffers leak in.
 * ZH: Memory 不再是 Context.turns 的纯投影。它是由显式 Context 简报初始化的
 * agent 私有缓存。本测试验证简报衍生的笔记（而非原始对话）出现在下一次模型
 * 调用中，且没有工具回放缓冲区泄漏。
 */
describe('Memory', () => {
    test('surfaces brief-derived notes without leaking tool or transcript buffers', async () => {
        const memory = await useContainer().getAsync(Memory, { name: 'flyflor', model: '', provider: '', contextLength: 0, maxTokens: 0 });
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
        const turn = await context.ingest({ text: userMessage });

        // EN: Seed the agent's private memory cache from the Context brief.
        // ZH: 用 Context 简报初始化 agent 的私有记忆缓存。
        memory.ingestBrief(context.brief());

        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: AgentMemory['role'] = AgentChatRole.User;

        expect(role).toBe(AgentChatRole.User);
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

    test('loads minimal worker persona package and keeps dynamic persona in brief notes', async () => {
        const memory = await useContainer().getAsync(Memory, {
            name: 'worker',
            model: '',
            provider: '',
            contextLength: 0,
            maxTokens: 0,
            promptPackage: './prompts/agents',
            promptSections: ['worker'],
        });

        memory.ingestBrief({
            turnId: 'turn_1',
            intent: 'research',
            goal: 'inspect one slice',
            persona: 'temporary evidence specialist',
            constraints: [],
            refs: [],
            recentSummaries: [],
        });

        const messages = memory.buildMessage();

        expect(messages[0]?.content).toBe(`# Worker Base

You are a temporary work unit.

Use the persona and task brief supplied in short-term notes. Stay inside the assigned slice and return a compact, evidence-based result.

Do not claim ownership of the whole user request. Do not save the temporary persona. Do not answer outside the assigned slice.`);
        expect(messages[1]?.content).toBe(`-[brief] turn turn_1: intent=research, goal=inspect one slice, constraints=[]
-[brief] persona: temporary evidence specialist`);
    });
});

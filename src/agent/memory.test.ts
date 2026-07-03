import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { AgentChatRole, Memory, type AgentMemory } from './memory';
import { Context } from '@/agent/context';

/**
 * ponytail: no hard-coded turn fixtures. The test sends one natural-language
 * message; the LLM (mocked) fills the turn in its own words. The assertions
 * only check what Memory promises to surface for the next model call: the
 * user's text, the LLM-derived goal and intent, and absence of replay buffers.
 */
describe('Memory', () => {
    test('projects one turn into the next model call without leaking tool or transcript buffers', async () => {
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
        // ponytail: bring the IOC-managed Memory and the freshly built Context
        // together by hand. The runtime wires them through Synapse in prod; the
        // test is a unit-level check on Memory's projection contract.
        (memory as unknown as { context: Context }).context = context;

        const userMessage = '实现计划';
        const turn = await context.ingest({ text: userMessage });
        const messages = memory.buildMessage();
        const system = messages[0]?.content ?? '';
        const user = messages[1]?.content ?? '';
        const role: AgentMemory['role'] = AgentChatRole.User;

        expect(role).toBe(AgentChatRole.User);
        expect(system).not.toContain('<agent_memory>');
        expect(user).toContain(userMessage);
        expect(turn.goal).toContain('synapse');
        expect(turn.intent).toBe('research');
        expect(user).toContain('synapse');
        expect(user).toContain('research');
        expect(user).not.toContain('toolCalls');
        expect(user).not.toContain('tool_call_id');
        expect(user).not.toContain('toolName');
        expect(user).not.toContain('"role":"tool"');
        expect(user).not.toContain('pending');
        expect(user).not.toContain('transcript');
    });
});
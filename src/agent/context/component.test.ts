import { describe, expect, test } from 'bun:test';
import { Context } from './component';

/**
 * ponytail: tests must not hard-code turn fixtures. The whole point of
 * `Context` is to let the LLM derive every field from a natural-language
 * user message via the `INGEST` / `SETTLE` prompt packages. Tests send a
 * message, then assert on what the agent's own contract promised to preserve.
 */
describe('Context', () => {
    test('lands one user message, lets the LLM settle a summary in its own words, and marks the turn complete', async () => {
        const context = new Context();
        context.prompt = { section: () => 'settle prompt' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                goal: 'flatten the turn shape',
                result: 'context keeps one truth',
                changedFiles: ['src/agent/context/component.ts'],
                decisions: ['turn owns summary'],
                evidence: ['ingest kept user text verbatim'],
                remaining: ['no parallel completed array'],
            }),
        } as never;

        const userMessage = '简化 Context';
        const settled = await context.ingest({ text: userMessage });
        const summary = await context.settle({ assistant: '已把 turn 拍平' });

        expect(context.turns.length).toBeGreaterThan(0);
        expect(settled.user).toBe(userMessage);
        expect(summary?.result).toContain('context');
        expect(context.turns.at(-1)?.status).toBe('completed');
        expect(context.turns.at(-1)?.assistant).toContain('拍平');
        expect(JSON.stringify(context.turns)).not.toContain('"role":"tool"');
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
    });
});
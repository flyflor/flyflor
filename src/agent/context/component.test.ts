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
        let request = 0;
        context.intelligence = {
            completeText: async () => {
                request += 1;
                return request === 1
                    ? JSON.stringify({
                        intent: 'research',
                        goal: 'flatten the turn shape',
                        constraints: [],
                        refs: [],
                        done: [],
                        open: [],
                        investigate: true,
                    })
                    : JSON.stringify({
                        goal: 'flatten the turn shape',
                        result: 'context keeps one truth',
                        changedFiles: ['src/agent/context/component.ts'],
                        decisions: ['turn owns summary'],
                        evidence: ['ingest kept user text verbatim'],
                        remaining: ['no parallel completed array'],
                    });
            },
        } as never;

        const userMessage = '简化 Context';
        const settled = await context.ingest({ text: userMessage, speakerId: 'test' });
        const summary = await context.settle(settled.id, { assistant: '已把 turn 拍平' });

        expect(context.turns.length).toBeGreaterThan(0);
        expect(settled.user).toBe(userMessage);
        expect(summary?.result).toContain('context');
        expect(context.turns.at(-1)?.status).toBe('completed');
        expect(context.turns.at(-1)?.assistant).toContain('拍平');
        expect(JSON.stringify(context.turns)).not.toContain('"role":"tool"');
        expect(JSON.stringify(context.turns)).not.toContain('tool_call_id');
    });

    test('briefs an agent with the current turn understanding, not the raw conversation', async () => {
        const context = new Context();
        context.prompt = { section: () => 'ingest prompt' } as never;
        context.intelligence = {
            completeText: async () => JSON.stringify({
                intent: 'research',
                goal: 'flatten the turn shape',
                cwd: '/tmp/flyflor',
                constraints: ['keep one truth'],
                refs: [{ type: 'path', value: 'src/agent/context/component.ts' }],
                done: [],
                open: [],
                investigate: true,
            }),
        } as never;

        await context.ingest({ text: '简化 Context', speakerId: 'test' });
        const brief = context.brief();

        expect(brief.intent).toBe('research');
        expect(brief.goal).toContain('flatten');
        expect(brief.constraints).toContain('keep one truth');
        expect(brief.refs[0]?.value).toBe('src/agent/context/component.ts');
        expect(brief.recentSummaries).toEqual([]);
    });
});
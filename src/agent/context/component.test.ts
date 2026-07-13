import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Context } from './component';

describe('Context', () => {
    test('owns the only Turn and exposes immutable briefs and summaries', () => {
        const context = useContainer().create(Context);
        const brief = context.begin('inspect', {
            intent: 'research',
            goal: 'inspect files',
            constraints: ['read first'],
            references: [{ type: 'path', value: 'src' }],
        });
        (brief.constraints as string[]).push('outside mutation');

        expect(context.brief(brief.turnId).constraints).toEqual(['read first']);
        context.pause(brief.turnId, { id: 'ask_1', kind: 'ask' });
        context.resume(brief.turnId, 'ask_1');
        const summary = context.complete(brief.turnId, 'done', ['read src']);

        expect(summary).toMatchObject({ goal: 'inspect files', answer: 'done', evidence: ['read src'] });
        expect(context.recent()).toEqual([summary]);
    });

    test('retains a bounded window of completed Turns', () => {
        const context = useContainer().create(Context);
        for (let index = 0; index < 40; index += 1) {
            const brief = context.begin(`input_${index}`, {
                intent: 'reply',
                goal: `goal_${index}`,
                constraints: [],
                references: [],
            });
            context.complete(brief.turnId, `answer_${index}`, []);
        }

        const recent = context.recent(100);
        expect(recent).toHaveLength(32);
        expect(recent[0]?.goal).toBe('goal_8');
        expect(recent.at(-1)?.goal).toBe('goal_39');
    });

    test('returns no history for zero and rejects invalid limits', () => {
        const context = useContainer().create(Context);
        const brief = context.begin('input', { intent: 'reply', goal: 'goal', constraints: [], references: [] });
        context.complete(brief.turnId, 'answer', []);

        expect(context.recent(0)).toEqual([]);
        expect(() => context.recent(-1)).toThrow('non-negative integer');
        expect(() => context.recent(Number.NaN)).toThrow('non-negative integer');
        expect(() => context.recent(1.5)).toThrow('non-negative integer');
    });

    test('rejects a whitespace-only final answer', () => {
        const context = useContainer().create(Context);
        const brief = context.begin('input', { intent: 'reply', goal: 'goal', constraints: [], references: [] });

        expect(() => context.complete(brief.turnId, '   ', [])).toThrow('answer is empty');
    });
});

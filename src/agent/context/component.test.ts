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
        context.pause(brief.turnId, { id: 'ask_1', kind: 'ask', prompt: 'scope?' });
        context.resume(brief.turnId, 'ask_1');
        const summary = context.complete(brief.turnId, 'done', ['read src']);

        expect(summary).toMatchObject({ goal: 'inspect files', answer: 'done', evidence: ['read src'] });
        expect(context.recent()).toEqual([summary]);
    });
});

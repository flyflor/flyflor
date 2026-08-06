import { describe, expect, test } from 'bun:test';
import type { AgentReport } from '@/agent/types';
import type { Focus } from '@/collective/context/types';
import type { ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import { History } from './component';

const config = (contextLength = 32000, maxTokens = 1000, historyShare = 0.25): ConfigService => ({
    collective: { leader: 'flyflor', contextCharLimit: 32000, historyShare },
    agents: { flyflor: { contextLength, maxTokens } },
    model: { contextLength, maxTokens },
} as unknown as ConfigService);

const history = (value?: ConfigService, completeText?: (content: string) => Promise<string>): History => {
    const component = useContainer().create(History);
    component.config = value ?? config();
    component.inference = {
        completeText: async (messages: Array<{ content: string }>) => completeText
            ? completeText(messages.at(-1)!.content)
            : 'condensed digest',
    } as never;
    component.prompt = { section: () => 'compress' } as never;
    return component;
};

const focus = (id: string, text: string): Focus => ({
    id,
    revision: 1,
    ownerSpeakerId: 'speaker-a',
    state: 'working',
    stimuli: [{ messageId: `${id}-m`, speakerId: 'speaker-a', connectionId: 'connection-a', text, receivedAt: 1 }],
    participants: [],
    consultants: [],
    goal: text,
    constraints: [],
    references: [],
    createdAt: 1,
    updatedAt: 1,
});

const report = (answer: string): AgentReport => ({ agentId: 'flyflor', answer, evidence: [], decisions: [], remaining: [], steps: 1 });

describe('History', () => {
    test('records a completed turn with verbatim user input and the final answer', async () => {
        const value = history();
        await value.record(focus('focus_1', 'first question'), report('first answer'));

        expect(value.snapshot()).toEqual([expect.objectContaining({
            focusId: 'focus_1',
            messages: [{ speakerId: 'speaker-a', text: 'first question' }],
            answer: 'first answer',
            agentId: 'flyflor',
        })]);
    });

    test('compresses an oversized turn with the model instead of truncating it', async () => {
        const value = history(undefined, async () => 'compressed answer');
        await value.record(focus('focus_1', 'question'), report('x'.repeat(20000)));

        const turn = value.snapshot()[0]!;
        expect(turn.answer).toBe('compressed answer');
        expect(JSON.stringify(value.snapshot())).not.toContain('...');
    });

    test('folds the oldest turns into a condensed digest when the model-window budget is exceeded', async () => {
        const value = history(config(2000, 1000), async () => 'digest of older turns');
        await value.record(focus('focus_1', 'q'.repeat(300)), report('a'.repeat(100)));
        await value.record(focus('focus_2', 'q'.repeat(300)), report('a'.repeat(100)));
        await value.record(focus('focus_3', 'q'.repeat(300)), report('a'.repeat(100)));

        const turns = value.snapshot();
        expect(turns.at(-1)?.focusId).toBe('focus_3');
        expect(turns.at(-1)?.condensed).toBeUndefined();
        expect(turns.slice(0, -1)).toHaveLength(1);
        expect(turns[0]).toMatchObject({ condensed: true, answer: 'digest of older turns' });
        expect(JSON.stringify(turns)).not.toContain('...');

        const wide = history(config(131072, 8192));
        await wide.record(focus('focus_1', 'q'.repeat(300)), report(''));
        await wide.record(focus('focus_2', 'q'.repeat(300)), report(''));

        expect(wide.snapshot().map((turn) => turn.focusId)).toEqual(['focus_1', 'focus_2']);
        expect(wide.snapshot().every((turn) => !turn.condensed)).toBe(true);
    });

    test('keeps the original turns untouched when compression is unavailable', async () => {
        const value = history(config(2000, 1000), async () => { throw Error('model unavailable'); });
        await value.record(focus('focus_1', 'q'.repeat(300)), report('a'.repeat(100)));
        await value.record(focus('focus_2', 'q'.repeat(300)), report('a'.repeat(100)));
        await value.record(focus('focus_3', 'q'.repeat(300)), report('a'.repeat(100)));

        expect(value.snapshot().map((turn) => turn.focusId)).toEqual(['focus_1', 'focus_2', 'focus_3']);
        expect(value.snapshot().every((turn) => !turn.condensed)).toBe(true);
    });

    test('serves the newest turns that fit the budget in chronological order', async () => {
        const value = history();
        await value.record(focus('focus_1', 'q'.repeat(200)), report(''));
        await value.record(focus('focus_2', 'q'.repeat(200)), report(''));
        await value.record(focus('focus_3', 'q'.repeat(200)), report(''));
        const size = JSON.stringify(value.snapshot()[0]).length + 1;

        expect(value.recent(size - 1).map((turn) => turn.focusId)).toEqual([]);
        expect(value.recent(size).map((turn) => turn.focusId)).toEqual(['focus_3']);
        expect(value.recent(size * 2 + 1).map((turn) => turn.focusId)).toEqual(['focus_2', 'focus_3']);
        expect(value.recent(size * 10).map((turn) => turn.focusId)).toEqual(['focus_1', 'focus_2', 'focus_3']);
    });

    test('returns defensive copies that never expose internal state', async () => {
        const value = history();
        await value.record(focus('focus_1', 'question'), report('answer'));

        value.snapshot()[0]!.answer = 'mutated';
        value.recent(10000)[0]!.messages[0]!.text = 'mutated';

        expect(value.snapshot()[0]!.answer).toBe('answer');
        expect(value.snapshot()[0]!.messages[0]!.text).toBe('question');
    });
});

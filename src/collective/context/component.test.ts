import { describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import { History } from '@/collective/history';
import { Ledger } from '@/ledger';
import { Context } from './component';
import type { Stimulus } from './types';

const stimulus = (messageId: string, speakerId = 'speaker-a', connectionId = `connection-${speakerId}`): Stimulus => ({
    messageId,
    speakerId,
    connectionId,
    text: `message ${messageId}`,
    receivedAt: Date.now(),
});

const ledger = (): Ledger => {
    const value = useContainer().create(Ledger);
    value.config = { ledger: { enabled: false, directory: '' } } as ConfigService;
    return value;
};

const context = (itemLimit = 128): Context => {
    const value = useContainer().create(Context);
    value.config = { collective: { contextItemLimit: itemLimit, contextCharLimit: 32000, historyShare: 0.25 } } as ConfigService;
    const history = useContainer().create(History);
    history.config = {
        collective: { leader: 'flyflor', contextCharLimit: 32000, historyShare: 0.25 },
        agents: {},
        model: { contextLength: 131072, maxTokens: 8192 },
    } as ConfigService;
    history.inference = { completeText: async () => 'condensed digest' } as never;
    history.prompt = { section: () => 'compress' } as never;
    value.history = history;
    value.ledger = ledger();
    return value;
};

describe('Context', () => {
    test('owns one global focus and merges cross-speaker participants', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), ['researcher']);
        const merged = value.merge({ ...stimulus('m2', 'speaker-b'), replyTo: 'm1' }, ['reviewer']);

        expect(() => value.open(stimulus('m3'), [])).toThrow('A focus is already active');
        expect(merged.id).toBe(focus.id);
        expect(merged.revision).toBe(2);
        expect(merged.participants.map((item) => item.speakerId)).toEqual(['speaker-a', 'speaker-b']);
        expect(merged.consultants).toEqual(['researcher', 'reviewer']);
        expect(value.targets(focus.id)).toEqual(['connection-speaker-a', 'connection-speaker-b']);
        expect(value.ownerTargets(focus.id)).toEqual(['connection-speaker-a']);
    });

    test('removes disconnected routes without removing speaker identity', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        value.merge(stimulus('m2', 'speaker-b'), []);

        value.disconnect('connection-speaker-a');

        expect(value.targets(focus.id)).toEqual(['connection-speaker-b']);
        expect(value.active()?.participants).toContainEqual({ speakerId: 'speaker-a', connectionIds: [] });
        value.connect(focus.id, 'speaker-a', 'connection-speaker-a-new');
        expect(value.ownerTargets(focus.id)).toEqual(['connection-speaker-a-new']);
    });

    test('builds agent input with local memory and discards raw stimuli after completion', async () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        value.observe(focus.id, {
            agentId: 'researcher',
            answer: 'Relevant finding',
            evidence: ['evidence metadata'],
            decisions: [],
            remaining: [],
            steps: 1,
        });
        const localMemory = [{ id: 'note-1', content: 'private reflection', source: 'reflection' as const, salience: 0.8, createdAt: 1, lastAccessedAt: 1 }];
        const input = value.forAgent('flyflor', localMemory);
        await value.complete(focus.id, {
            agentId: 'flyflor',
            answer: 'Final semantic summary',
            evidence: [],
            decisions: [],
            remaining: [],
            steps: 1,
        });

        expect(input.localMemory).toEqual(localMemory);
        expect(input.items.map((item) => item.content)).toContain('Relevant finding');
        expect(value.active()).toBeUndefined();
        expect(JSON.stringify(value.snapshot())).not.toContain('message m1');
        expect(value.snapshot().filter((item) => item.content === 'Final semantic summary').map((item) => item.kind)).toEqual(['summary']);
        expect(context().snapshot()).toEqual([]);
    });

    test('records completed turns and injects them verbatim into later agent input', async () => {
        const value = context();
        const first = value.open(stimulus('m1'), []);
        await value.complete(first.id, { agentId: 'flyflor', answer: 'first answer', evidence: [], decisions: [], remaining: [], steps: 1 });
        value.open(stimulus('m2'), []);

        const input = value.forAgent('flyflor', []);

        expect(input.history).toHaveLength(1);
        expect(input.history[0]).toMatchObject({ focusId: first.id, answer: 'first answer' });
        expect(input.history[0]?.messages[0]?.text).toBe('message m1');
    });

    test('excludes verbatim history that exceeds its share of a tight budget', async () => {
        const value = context();
        const first = value.open(stimulus('m1'), []);
        await value.complete(first.id, { agentId: 'flyflor', answer: 'first answer', evidence: [], decisions: [], remaining: [], steps: 1 });
        value.open(stimulus('m2'), []);

        const input = value.forAgent('flyflor', [], 400);

        expect(input.history).toEqual([]);
    });

    test('absorbs ask answers as constraints and confirmations as sourced decisions', () => {        const value = context();
        const focus = value.open(stimulus('m1'), []);

        value.observeInteraction(focus.id, 'speaker-a', 'answer-1', {
            kind: 'ask',
            answers: [
                { question: 'Target?', answer: 'The IPC boundary' },
                { question: 'Compatibility?', answer: 'None' },
            ],
        });
        value.observeInteraction(focus.id, 'speaker-a', 'answer-2', { kind: 'confirm', approved: false });

        expect(value.active()?.constraints).toEqual(['Target?: The IPC boundary', 'Compatibility?: None']);
        expect(value.forAgent('flyflor', []).focus.constraints).toEqual(['Target?: The IPC boundary', 'Compatibility?: None']);
        expect(value.snapshot()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'constraint',
                content: 'Target?: The IPC boundary',
                sourceFocusId: focus.id,
                sourceMessageIds: ['answer-1'],
                speakerIds: ['speaker-a'],
            }),
            expect.objectContaining({
                kind: 'constraint',
                content: 'Compatibility?: None',
                sourceFocusId: focus.id,
                sourceMessageIds: ['answer-1'],
                speakerIds: ['speaker-a'],
            }),
            expect.objectContaining({
                kind: 'decision',
                content: 'Tool confirmation rejected',
                sourceFocusId: focus.id,
                sourceMessageIds: ['answer-2'],
                speakerIds: ['speaker-a'],
            }),
        ]));
    });

    test('evicts ordinary low-salience items before protected decisions and open items', () => {
        const value = context(2);
        const focus = value.open(stimulus('m1'), []);
        value.observe(focus.id, {
            agentId: 'reviewer',
            answer: 'ordinary fact',
            evidence: ['ordinary evidence'],
            decisions: ['locked decision'],
            remaining: ['unresolved issue'],
            steps: 1,
        });

        expect(value.snapshot().map((item) => item.content)).toEqual(['locked decision', 'unresolved issue']);
    });

    test('enforces the hard item cap while retaining full active constraints in Focus', () => {
        const value = context(2);
        const focus = value.open(stimulus('m1'), []);
        value.observeInteraction(focus.id, 'speaker-a', 'answer-1', {
            kind: 'ask',
            answers: [
                { question: 'one', answer: '1' },
                { question: 'two', answer: '2' },
                { question: 'three', answer: '3' },
            ],
        });

        expect(value.snapshot().map((item) => item.content)).toEqual(['two: 2', 'three: 3']);
        expect(value.active()?.constraints).toEqual(['one: 1', 'two: 2', 'three: 3']);
    });

    test('applies the per-agent character budget to global items before local notes', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        value.observe(focus.id, { agentId: 'researcher', answer: '', evidence: ['e'], decisions: [], remaining: [], steps: 1 });
        const note = { id: 'note', content: 'n', source: 'reflection' as const, salience: 1, createdAt: 1, lastAccessedAt: 1 };
        const complete = value.forAgent('flyflor', [], 32000);
        const capacity = JSON.stringify({ focus: complete.focus, history: [], globalWorkspace: [], localMemory: [] }).length
            + JSON.stringify(complete.items[0]).length + 1;

        const input = value.forAgent('flyflor', [note], capacity);

        expect(input.items.map((item) => item.content)).toEqual(['e']);
        expect(input.localMemory).toEqual([]);
    });

    test('projects an oversized active focus without mutating conversational truth', () => {
        const value = context();
        const text = 'focus detail '.repeat(2000);
        value.open({ ...stimulus('m1'), text }, []);

        const input = value.forAgent('flyflor', [], 1000);

        expect(JSON.stringify(input.focus).length).toBeLessThanOrEqual(1000);
        expect(input.focus.goal.endsWith('...')).toBe(true);
        expect(input.focus.messages[0]?.text.endsWith('...')).toBe(true);
        expect(value.active()?.stimuli[0]?.text).toBe(text);
    });

    test('keeps the first and latest messages when projecting a heavily revised focus', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        for (let index = 2; index <= 100; index += 1) value.merge(stimulus(`m${index}`), []);

        const input = value.forAgent('flyflor', [], 32000);

        expect(input.focus.messages).toHaveLength(64);
        expect(input.focus.messages[0]?.messageId).toBe('m1');
        expect(input.focus.messages.at(-1)?.messageId).toBe('m100');
        expect(value.active()?.stimuli).toHaveLength(100);
        expect(value.active()?.id).toBe(focus.id);
    });

    test('keeps first and latest constraints while fitting many short answers to budget', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        const answers = Array.from({ length: 100 }, (_, index) => ({ question: `question-${index}`, answer: `answer-${index}` }));
        value.observeInteraction(focus.id, 'speaker-a', 'answer-1', { kind: 'ask', answers });

        const input = value.forAgent('flyflor', [], 1000);

        expect(JSON.stringify(input.focus).length).toBeLessThanOrEqual(1000);
        expect(input.focus.constraints[0]).toBe('question-0: answer-0');
        expect(input.focus.constraints.at(-1)).toBe('question-99: answer-99');
        expect(value.active()?.constraints).toHaveLength(100);
    });

    test('bounds one semantic item without losing its source metadata', () => {
        const value = context();
        const focus = value.open(stimulus('m1'), []);
        value.observe(focus.id, { agentId: 'researcher', answer: '', evidence: ['x'.repeat(9000)], decisions: [], remaining: [], steps: 1 });

        const item = value.snapshot()[0]!;
        expect(item.content.length).toBe(8000);
        expect(item.content.endsWith('...')).toBe(true);
        expect(item.sourceMessageIds).toEqual(['m1']);
    });

    test('protects evidence referenced by the current focus from ordinary eviction', async () => {
        const value = context(1);
        const first = value.open(stimulus('m1'), []);
        value.observe(first.id, { agentId: 'researcher', answer: '', evidence: ['referenced evidence'], decisions: [], remaining: [], steps: 1 });
        await value.complete(first.id, { agentId: 'flyflor', answer: '', evidence: [], decisions: [], remaining: [], steps: 1 });
        const second = value.open({ ...stimulus('m2'), replyTo: 'm1' }, []);
        value.observe(second.id, { agentId: 'researcher', answer: '', evidence: ['new evidence'], decisions: [], remaining: [], steps: 1 });

        expect(value.snapshot().map((item) => item.content)).toEqual(['referenced evidence']);
    });
});

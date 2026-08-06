import { describe, expect, test } from 'bun:test';
import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import type { Inference } from '@/inference';
import { Attention } from './service';
import type { Focus, Stimulus } from '../context';

const stimulus = (messageId: string, speakerId = 'speaker-a'): Stimulus => ({
    messageId,
    speakerId,
    connectionId: `connection-${speakerId}`,
    text: messageId,
    receivedAt: Date.now(),
});

const focus = (state: Focus['state'] = 'working'): Focus => ({
    id: 'focus_1',
    revision: 1,
    ownerSpeakerId: 'speaker-a',
    state,
    stimuli: [stimulus('m1')],
    participants: [{ speakerId: 'speaker-a', connectionIds: ['connection-speaker-a'] }],
    consultants: ['researcher'],
    goal: 'm1',
    constraints: [],
    references: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

const roster: Record<string, FAgentProfileConfiguration> = {
    flyflor: { name: 'flyflor', role: 'leader', description: 'leader', capabilities: [], actionScope: 'full', model: 'm', provider: 'p', contextLength: 1, maxTokens: 1 },
    researcher: { name: 'researcher', role: 'specialist', description: 'research', capabilities: ['research'], actionScope: 'read', model: 'm', provider: 'p', contextLength: 1, maxTokens: 1 },
};

const attention = (queueLimit = 64): Attention => {
    const value = useContainer().create(Attention);
    value.config = { collective: { queueLimit } } as ConfigService;
    value.prompt = { section: () => 'focus' } as never;
    return value;
};

describe('Attention', () => {
    test('merges explicit replies before semantic inference', async () => {
        const value = attention();
        value.inference = { completeText: () => { throw Error('must not run'); } } as unknown as Inference;

        const decision = await value.decide({ ...stimulus('m2'), replyTo: 'm1' }, focus(), roster);

        expect(decision).toEqual({ disposition: 'merge', salience: 1, consultants: ['researcher'] });
    });

    test('normalizes semantic decisions and rejects invalid consultants', async () => {
        const value = attention();
        value.inference = { completeText: async () => '{"relation":"merge","salience":2,"consultants":["researcher","flyflor","unknown"]}' } as unknown as Inference;

        expect(await value.decide(stimulus('m2'), focus(), roster)).toEqual({
            disposition: 'merge',
            salience: 1,
            consultants: ['researcher'],
        });
    });

    test('makes waiting a hard gate and applies speaker fairness in the queue', async () => {
        const value = attention(2);
        value.inference = { completeText: async () => '{"relation":"merge"}' } as unknown as Inference;

        expect((await value.decide({ ...stimulus('m2'), replyTo: 'm1' }, focus('waiting'), roster)).disposition).toBe('queue');
        expect((await value.decide({ ...stimulus('m3'), replyTo: 'm1' }, focus('cancelled'), roster)).disposition).toBe('queue');
        value.enqueue(stimulus('same', 'speaker-a'), { disposition: 'queue', salience: 0.5, consultants: [] });
        value.enqueue(stimulus('other', 'speaker-b'), { disposition: 'queue', salience: 0.5, consultants: [] });
        expect(value.next('speaker-a')?.stimulus.messageId).toBe('other');
    });

    test('rejects the newest stimulus when the queue is full', () => {
        const value = attention(1);
        value.enqueue(stimulus('m1'), { disposition: 'queue', salience: 0.5, consultants: [] });

        expect(() => value.enqueue(stimulus('m2'), { disposition: 'queue', salience: 0.5, consultants: [] })).toThrow('Attention queue is full');
        expect(value.size()).toBe(1);
    });

    test('updates the queued connection on an idempotent reconnect', () => {
        const value = attention();
        value.enqueue(stimulus('m1'), { disposition: 'queue', salience: 0.5, consultants: [] });

        value.reconnect('m1', 'speaker-a', 'connection-reconnected');

        expect(value.next()?.stimulus.connectionId).toBe('connection-reconnected');
    });

    test('absorbs an explicit queued reply chain when its root becomes active', () => {
        const value = attention();
        value.enqueue({ ...stimulus('m2', 'speaker-b'), replyTo: 'm1' }, { disposition: 'queue', salience: 0.5, consultants: ['researcher'] });
        value.enqueue({ ...stimulus('m3', 'speaker-c'), replyTo: 'm2' }, { disposition: 'queue', salience: 0.5, consultants: [] });
        value.enqueue(stimulus('unrelated', 'speaker-d'), { disposition: 'queue', salience: 0.5, consultants: [] });

        const replies = value.takeReplies(['m1']);

        expect(replies.map((item) => item.stimulus.messageId)).toEqual(['m2', 'm3']);
        expect(value.size()).toBe(1);
        expect(value.next()?.stimulus.messageId).toBe('unrelated');
    });

    test('bounds model classification input without mutating the active focus', async () => {
        const value = attention();
        value.config = { collective: { queueLimit: 64, contextCharLimit: 1000 } } as ConfigService;
        const active = focus();
        active.goal = 'goal '.repeat(2000);
        active.stimuli = Array.from({ length: 100 }, (_, index) => ({
            ...stimulus(`m${index}`),
            text: `message ${index} `.repeat(1000),
        }));
        const original = structuredClone(active);
        let modelInput = '';
        value.inference = {
            completeText: async (messages: Array<{ content: string }>) => {
                modelInput = messages.at(-1)?.content ?? '';
                return '{"relation":"queue","salience":0.5,"consultants":[]}';
            },
        } as unknown as Inference;

        await value.decide({ ...stimulus('incoming'), text: 'incoming '.repeat(2000) }, active, roster);

        expect(modelInput.length).toBeLessThanOrEqual(1000);
        expect(() => JSON.parse(modelInput)).not.toThrow();
        expect(active).toEqual(original);
    });
});

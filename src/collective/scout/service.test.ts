import { describe, expect, test } from 'bun:test';
import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import type { Inference } from '@/inference';
import { Scout } from './service';
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

const scout = (queueLimit = 64): Scout => {
    const value = useContainer().create(Scout);
    value.config = { collective: { queueLimit } } as ConfigService;
    value.prompt = { section: () => 'focus' } as never;
    return value;
};

describe('Scout', () => {
    test('merges explicit replies before semantic inference', async () => {
        const value = scout();
        value.inference = { completeText: () => { throw Error('must not run'); } } as unknown as Inference;

        const spike = await value.detect({ ...stimulus('m2'), replyTo: 'm1' }, focus(), roster);

        expect(spike).toEqual({ disposition: 'merge', salience: 1, consultants: ['researcher'] });
    });

    test('normalizes semantic discharges and rejects invalid consultants', async () => {
        const value = scout();
        value.inference = { completeText: async () => '{"relation":"merge","salience":2,"consultants":["researcher","flyflor","unknown"]}' } as unknown as Inference;

        expect(await value.detect(stimulus('m2'), focus(), roster)).toEqual({
            disposition: 'merge',
            salience: 1,
            consultants: ['researcher'],
        });
    });

    test('makes a non-working focus a hard queue gate', async () => {
        const value = scout();
        value.inference = { completeText: async () => '{"relation":"merge"}' } as unknown as Inference;

        expect((await value.detect({ ...stimulus('m2'), replyTo: 'm1' }, focus('waiting'), roster)).disposition).toBe('queue');
        expect((await value.detect({ ...stimulus('m3'), replyTo: 'm1' }, focus('cancelled'), roster)).disposition).toBe('queue');
    });

    test('falls back to a deterministic discharge when the model fails', async () => {
        const value = scout();
        value.inference = { completeText: async () => { throw Error('model down'); } } as unknown as Inference;

        expect(await value.detect(stimulus('m2'), focus(), roster)).toEqual({
            disposition: 'queue',
            salience: 0.5,
            consultants: [],
        });
        expect((await value.detect(stimulus('m2'), undefined, roster)).disposition).toBe('focus');
    });

    test('bounds model classification input without mutating the active focus', async () => {
        const value = scout();
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

        await value.detect({ ...stimulus('incoming'), text: 'incoming '.repeat(2000) }, active, roster);

        expect(modelInput.length).toBeLessThanOrEqual(1000);
        expect(() => JSON.parse(modelInput)).not.toThrow();
        expect(active).toEqual(original);
    });
});

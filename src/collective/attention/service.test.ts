import { describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { useContainer } from '@/core';
import { Attention } from './service';
import type { Spike } from '../scout';
import type { Stimulus } from '../context';

const stimulus = (messageId: string, speakerId = 'speaker-a'): Stimulus => ({
    messageId,
    speakerId,
    connectionId: `connection-${speakerId}`,
    text: messageId,
    receivedAt: Date.now(),
});

const spike = (salience = 0.5, consultants: string[] = []): Spike => ({ disposition: 'queue', salience, consultants });

const attention = (queueLimit = 64): Attention => {
    const value = useContainer().create(Attention);
    value.config = { collective: { queueLimit } } as ConfigService;
    return value;
};

describe('Attention', () => {
    test('applies salience, waiting age, and speaker fairness in the queue', () => {
        const value = attention(4);
        value.enqueue(stimulus('salient', 'speaker-a'), spike(0.9));
        value.enqueue(stimulus('same', 'speaker-a'), spike(0.5));
        value.enqueue(stimulus('other', 'speaker-b'), spike(0.5));

        expect(value.next('speaker-a')?.stimulus.messageId).toBe('salient');
        expect(value.next('speaker-a')?.stimulus.messageId).toBe('other');
        expect(value.next()?.stimulus.messageId).toBe('same');
    });

    test('rejects the newest stimulus when the queue is full', () => {
        const value = attention(1);
        value.enqueue(stimulus('m1'), spike());

        expect(() => value.enqueue(stimulus('m2'), spike())).toThrow('Attention queue is full');
        expect(value.size()).toBe(1);
    });

    test('updates the queued connection on an idempotent reconnect', () => {
        const value = attention();
        value.enqueue(stimulus('m1'), spike());

        value.reconnect('m1', 'speaker-a', 'connection-reconnected');

        expect(value.next()?.stimulus.connectionId).toBe('connection-reconnected');
    });

    test('absorbs an explicit queued reply chain when its root becomes active', () => {
        const value = attention();
        value.enqueue({ ...stimulus('m2', 'speaker-b'), replyTo: 'm1' }, spike(0.5, ['researcher']));
        value.enqueue({ ...stimulus('m3', 'speaker-c'), replyTo: 'm2' }, spike());
        value.enqueue(stimulus('unrelated', 'speaker-d'), spike());

        const replies = value.takeReplies(['m1']);

        expect(replies.map((item) => item.stimulus.messageId)).toEqual(['m2', 'm3']);
        expect(value.size()).toBe(1);
        expect(value.next()?.stimulus.messageId).toBe('unrelated');
    });
});

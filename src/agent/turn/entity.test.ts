import { describe, expect, test } from 'bun:test';
import { useContainer } from '@/core';
import { Turn } from './entity';

describe('Turn', () => {
    test('owns pause, resume, completion, and immutable snapshots', () => {
        const turn = useContainer().create(Turn, 'turn_1', 'inspect the project', {
            mode: 'research',
            goal: 'understand the project',
            constraints: ['keep the boundary small'],
            references: [{ type: 'path', value: 'src/agent' }],
        });

        turn.pause({ id: 'ask_1', kind: 'ask', prompt: 'choose scope' });
        expect(turn.status).toBe('paused');
        turn.resume('ask_1');
        turn.complete('done', ['read src/agent']);

        const snapshot = turn.snapshot();
        expect(snapshot).toMatchObject({ status: 'completed', answer: 'done', evidence: ['read src/agent'] });
        snapshot.constraints.push('mutated copy');
        expect(turn.snapshot().constraints).toEqual(['keep the boundary small']);
    });

    test('fails an unfinished turn without hiding the error', () => {
        const turn = useContainer().create(Turn, 'turn_2', 'break', {
            mode: 'research',
            goal: 'fail visibly',
            constraints: [],
            references: [],
        });

        turn.fail(new Error('provider unavailable'));

        expect(turn.snapshot()).toMatchObject({ status: 'failed', error: 'provider unavailable' });
        expect(() => turn.complete('late')).toThrow('expected active');
    });
});

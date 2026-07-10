import { describe, expect, test } from 'bun:test';
import { AgentChatRole } from '@/agent/types';
import { useContainer } from '@/core';
import { Memory } from './component';

function memory(): Memory {
    return useContainer().create(Memory);
}

describe('Memory', () => {
    test('owns one active turn and builds continuity from completed turns', () => {
        const state = memory();
        const first = state.begin('first question', {
            mode: 'reply',
            goal: 'answer first',
            constraints: [],
            references: [],
        });
        state.complete(first.id, 'first answer');
        const second = state.begin('second question', {
            mode: 'research',
            goal: 'answer second',
            constraints: [],
            references: [],
        });

        expect(state.current()?.id).toBe(second.id);
        expect(state.messages()).toEqual([
            { role: AgentChatRole.User, content: 'first question' },
            { role: AgentChatRole.Assistant, content: 'first answer' },
        ]);
        expect(() => state.begin('overlap', second.perception)).toThrow('already active');
    });

    test('allows the next turn after failure', () => {
        const state = memory();
        const failed = state.begin('bad turn', {
            mode: 'research',
            goal: 'fail',
            constraints: [],
            references: [],
        });
        state.fail(failed.id, Error('boom'));

        const next = state.begin('next turn', {
            mode: 'reply',
            goal: 'continue',
            constraints: [],
            references: [],
        });

        expect(next.status).toBe('active');
        expect(state.snapshots()[0]).toMatchObject({ status: 'failed', error: 'boom' });
    });
});

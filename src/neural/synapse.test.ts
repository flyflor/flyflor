import { describe, expect, test } from 'bun:test';
import type { Assignment } from '@/agent';
import { Memory } from '@/agent/memory';
import { Turn } from '@/agent/turn';
import { useContainer } from '@/core';
import { Synapse } from './synapse';
import { SynapseSignalType, type CoordinatePlan } from './types';

describe('SynapseSignalType', () => {
    test('keeps the external interaction signals stable', () => {
        expect(String(SynapseSignalType.Pause)).toBe('pause');
        expect(String(SynapseSignalType.Resume)).toBe('resume');
        expect(String(SynapseSignalType.Ask)).toBe('ask');
        expect(String(SynapseSignalType.Confirm)).toBe('confirm');
    });
});

describe('Synapse coordinate', () => {
    test('dispatches isolated workers in parallel, reviews, and completes the same turn', async () => {
        const plan: CoordinatePlan = {
            intent: 'understand the cluster design',
            slices: [
                { profile: 'worker', persona: 'intent analyst', brief: 'study intent', slice: 'intent' },
                { profile: 'worker', persona: 'risk analyst', brief: 'study risk', slice: 'risk' },
            ],
            review: { profile: 'reviewer', persona: 'strict reviewer', brief: 'review all worker results', focus: 'coverage' },
            synthesisHint: 'merge and respect review',
        };
        const { synapse, turn, assignments, replies } = coordinateHarness(plan);

        await synapse.coordinate(turn);

        expect(assignments.slice(0, 2).map((assignment) => assignment.goal)).toEqual(['study intent', 'study risk']);
        expect(assignments.slice(0, 2).map((assignment) => assignment.persona)).toEqual(['intent analyst', 'risk analyst']);
        expect(assignments[2]?.persona).toBe('strict reviewer');
        expect(synapse.memory.turn(turn.id).snapshot()).toMatchObject({ status: 'completed', answer: 'final answer' });
        expect(replies).toEqual(['final answer', null]);
    });

    test('uses the active profile when planning returns no slices', async () => {
        const plan: CoordinatePlan = {
            intent: 'single path',
            slices: [],
            review: { profile: 'reviewer', persona: 'reviewer', brief: 'review result', focus: 'quality' },
            synthesisHint: 'summarize',
        };
        const { synapse, turn, assignments } = coordinateHarness(plan);

        await synapse.coordinate(turn);

        expect(assignments[0]?.profile).toBe('flyflor');
        expect(assignments[0]?.goal).toBe('turn goal');
        expect(assignments[1]?.profile).toBe('reviewer');
    });
});

function coordinateHarness(plan: CoordinatePlan): {
    synapse: Synapse;
    turn: Turn;
    assignments: Assignment[];
    replies: unknown[];
} {
    const synapse = useContainer().create(Synapse);
    const memory = useContainer().create(Memory);
    const turn = memory.begin('latest request', {
        mode: 'coordinate',
        goal: 'turn goal',
        constraints: ['keep scope'],
        references: [],
    });
    const assignments: Assignment[] = [];
    const replies: unknown[] = [];
    synapse.memory = memory;
    synapse.active = 'flyflor';
    synapse.prompt = { section: (name: string) => `${name} prompt` } as never;
    synapse.on(SynapseSignalType.Reply, (signal) => {
        replies.push(signal.data);
    });
    let modelCall = 0;
    synapse.agentPool = {
        flyflor: {
            think: async () => {
            modelCall += 1;
            return modelCall === 1 ? JSON.stringify(plan) : 'final answer';
            },
        } as never,
    };
    let worker = 0;
    synapse.spawnWorker = async () => {
        worker += 1;
        const current = worker;
        return {
            work: async (assignment: Assignment) => {
                assignments.push(assignment);
                return current > Math.max(plan.slices.length, 1)
                    ? { answer: 'review answer', evidence: ['review evidence'] }
                    : { answer: 'worker answer', evidence: ['worker evidence'] };
            },
        } as never;
    };
    return { synapse, turn, assignments, replies };
}

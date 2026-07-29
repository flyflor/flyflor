import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { WorkspaceBrief } from '@/neural/workspace';
import { Workspace } from '@/neural/workspace';
import { Synapse } from './synapse';
import { SynapseSignalType, type CoordinatePlan } from './types';
import { DispositionRelation } from './awareness/types';

describe('SynapseSignalType', () => {
    test('exposes pause and resume as control signals', () => {
        expect(String(SynapseSignalType.Pause)).toBe('pause');
        expect(String(SynapseSignalType.Resume)).toBe('resume');
        expect(String(SynapseSignalType.Ask)).toBe('ask');
        expect(String(SynapseSignalType.Confirm)).toBe('confirm');
    });

    test('exposes coordinate for cortex dispatch', () => {
        expect(String(SynapseSignalType.Coordinate)).toBe('coordinate');
    });
});

describe('Synapse coordinate', () => {
    test('passes slice briefs to thought threads, then reviews before synthesis', async () => {
        const plan: CoordinatePlan = {
            intent: 'understand the cluster design',
            strategy: 'parallel',
            slices: [
                { brief: 'study intent', slice: 'intent' },
                { brief: 'study risk', slice: 'risk' },
            ],
            review: { brief: 'review all slice results', focus: 'coverage and contradictions' },
            synthesisHint: 'merge and respect review',
        };
        const synapse = coordinateHarness(plan);
        const replies: unknown[] = [];
        synapse.on(SynapseSignalType.Reply, (signal: { data: unknown }) => {
            replies.push(signal.data);
        });

        await (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(synapse.workerBriefs.map((brief) => brief.goal)).toEqual(['study intent', 'study risk']);
        expect(synapse.workerBriefs.map((brief) => brief.constraints.at(-1))).toEqual(['intent', 'risk']);
        expect(JSON.parse(synapse.seenReviewBrief?.goal ?? '{}')).toMatchObject({ review: 'review all slice results', focus: 'coverage and contradictions' });
        const synthesis = JSON.parse(synapse.synthesisInput) as { outcomes: Array<{ result: string }>; review: { result: string } };
        expect(synthesis.outcomes.map((outcome) => outcome.result)).toEqual(['worker answer', 'worker answer']);
        expect(synthesis.review.result).toBe('review answer');
        expect(replies).toEqual([{ turnId: 'turn_1', chunk: 'final answer' }, { turnId: 'turn_1', chunk: null }]);
    });

    test('falls back to one slice from the turn goal when the plan has no slices and still runs review', async () => {
        const plan: CoordinatePlan = {
            intent: 'single path',
            strategy: 'parallel',
            slices: [],
            review: { brief: 'review single result', focus: 'answer quality' },
            synthesisHint: 'summarize single result',
        };
        const synapse = coordinateHarness(plan);

        await (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(synapse.workerBriefs).toHaveLength(1);
        expect(synapse.workerBriefs[0]?.goal).toBe('turn goal');
        expect(synapse.seenReviewBrief).toBeDefined();
    });

    test('runs slices in parallel as unconscious processors', async () => {
        const plan: CoordinatePlan = {
            intent: 'two independent parts',
            strategy: 'parallel',
            slices: [
                { brief: 'study one', slice: 'one' },
                { brief: 'study two', slice: 'two' },
            ],
            review: { brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        const started: string[] = [];
        const gates: Array<() => void> = [];
        let spawns = 0;
        synapse.spawnThought = async () => {
            spawns += 1;
            const isReviewer = spawns > 2;
            return {
                understand: async (brief: WorkspaceBrief) => {
                    if (isReviewer) return { answer: 'review answer', steps: 1, completed: true, paused: false, evidence: [] };
                    started.push(brief.goal);
                    await new Promise<void>((resolve) => gates.push(resolve));
                    return { answer: `answer ${brief.goal}`, steps: 1, completed: true, paused: false, evidence: [] };
                },
            } as never;
        };

        const run = (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Both slices started before either finished: true concurrency.
        expect(started).toEqual(['study one', 'study two']);
        for (const release of gates) release();
        await run;
    });

    test('isolates a failed slice and still synthesizes from the survivors', async () => {
        const plan: CoordinatePlan = {
            intent: 'two parts, one doomed',
            strategy: 'parallel',
            slices: [
                { brief: 'study ok', slice: 'ok' },
                { brief: 'study fail', slice: 'fail' },
            ],
            review: { brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        let spawns = 0;
        synapse.spawnThought = async () => {
            spawns += 1;
            const isReviewer = spawns > 2;
            return {
                understand: async (brief: WorkspaceBrief) => {
                    if (isReviewer) return { answer: 'review answer', steps: 1, completed: true, paused: false, evidence: [] };
                    if (brief.goal === 'study fail') throw Error('worker exploded');
                    return { answer: 'worker answer', steps: 1, completed: true, paused: false, evidence: ['e'] };
                },
            } as never;
        };
        const replies: unknown[] = [];
        synapse.on(SynapseSignalType.Reply, (signal: { data: unknown }) => {
            replies.push(signal.data);
        });

        await (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        const synthesis = JSON.parse(synapse.synthesisInput) as { outcomes: Array<{ result: string; failed?: boolean; reason?: string }> };
        expect(synthesis.outcomes).toHaveLength(2);
        expect(synthesis.outcomes.find((outcome) => outcome.failed)?.reason).toBe('worker exploded');
        expect(replies).toEqual([{ turnId: 'turn_1', chunk: 'final answer' }, { turnId: 'turn_1', chunk: null }]);
    });

    test('throws into the turn error boundary when every slice fails', async () => {
        const plan: CoordinatePlan = {
            intent: 'all doomed',
            strategy: 'parallel',
            slices: [
                { brief: 'study one', slice: 'one' },
                { brief: 'study two', slice: 'two' },
            ],
            review: { brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        synapse.spawnThought = async () => ({
            understand: async () => {
                throw Error('boom');
            },
        } as never);

        await expect(
            (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1'),
        ).rejects.toThrow('Every coordinate slice failed');
    });

    test('propagates the main abort instead of isolating it as a slice failure', async () => {
        const plan: CoordinatePlan = {
            intent: 'abort wins',
            strategy: 'parallel',
            slices: [
                { brief: 'study one', slice: 'one' },
                { brief: 'study two', slice: 'two' },
            ],
            review: { brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        const controller = new AbortController();
        synapse.spawnThought = async () => ({
            understand: async (_brief: WorkspaceBrief, signal?: AbortSignal) => {
                await new Promise<never>((_, reject) => {
                    signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
                });
            },
        } as never);

        const run = (synapse as unknown as { coordinate: (chunk: string, turnId: string, signal?: AbortSignal) => Promise<void> })
            .coordinate('latest request', 'turn_1', controller.signal);
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.abort();

        await expect(run).rejects.toThrow('aborted');
    });
});

describe('Synapse cancellation and speaker ownership', () => {
    test('aborts an ingest that has not created a Workspace turn when its speaker disconnects', async () => {
        let receivedSignal: AbortSignal | undefined;
        let release: (() => void) | undefined;
        const brain = {
            next: async (input: unknown) => {
                receivedSignal = (input as { signal?: AbortSignal }).signal;
                await new Promise<void>((resolve) => { release = resolve; });
            },
        };
        const synapse = setupSynapse(brain);
        const operation = synapse.attend({ id: 'stim_1', speakerId: 'conn_1', text: 'hello', ts: Date.now() }, {
            relation: DispositionRelation.New,
            urgent: false,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(receivedSignal?.aborted).toBe(false);
        synapse.forgetSpeaker('conn_1');
        expect(receivedSignal?.aborted).toBe(true);
        release?.();
        await operation;
    });

    test('keeps working turns while removing a disconnected speaker', () => {
        const synapse = setupSynapse({ next: async () => undefined });
        synapse.workspace.turns = [
            {
                id: 'turn_waiting', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'wait',
                constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
            },
            {
                id: 'turn_working', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'work',
                constraints: [], refs: [], done: [], open: [], investigate: false, ts: 2,
            },
        ];

        synapse.forgetSpeaker('conn_1');

        expect(synapse.workspace.turns.map((turn) => turn.id)).toEqual(['turn_waiting', 'turn_working']);
    });
});

function setupSynapse(brain: { next(input: unknown): Promise<void> }) {
    const synapse = new Synapse();
    synapse.brain = brain as never;
    synapse.workspace = new Workspace();
    synapse.awareness = {
        preempted: () => false,
        turnSettled: () => undefined,
        turnInterrupted: () => undefined,
        say: () => undefined,
    } as never;
    return synapse;
}

function coordinateHarness(plan: CoordinatePlan): Synapse & {
    workerBriefs: WorkspaceBrief[];
    seenReviewBrief?: WorkspaceBrief;
    synthesisInput: string;
} {
    const synapse = new Synapse() as Synapse & {
        workerBriefs: WorkspaceBrief[];
        seenReviewBrief?: WorkspaceBrief;
        synthesisInput: string;
    };
    synapse.workerBriefs = [];
    synapse.synthesisInput = '';
    synapse.workspace = {
        brief: (turnId?: string) => ({
            turnId: turnId ?? 'turn_1',
            intent: 'research',
            goal: 'turn goal',
            constraints: [],
            refs: [],
            done: [],
            open: [],
            workspace: [],
        }),
        turn: () => ({ status: 'completed' }),
        settle: async () => undefined,
    } as never;
    synapse.planPrompt = { section: () => 'plan prompt' } as never;
    synapse.synthesisPrompt = { section: () => 'synthesis prompt' } as never;
    synapse.awareness = { preempted: () => false } as never;
    let call = 0;
    synapse.intelligence = {
        completeText: async (messages: Array<{ content: string }>) => {
            call += 1;
            if (call === 1) return JSON.stringify(plan);
            synapse.synthesisInput = messages.at(-1)?.content ?? '';
            return 'final answer';
        },
    } as never;
    let spawned = 0;
    synapse.spawnThought = async () => {
        spawned += 1;
        const index = spawned;
        return {
            understand: async (brief: WorkspaceBrief) => {
                if (index > Math.max(plan.slices.length, 1)) {
                    synapse.seenReviewBrief = brief;
                    return { answer: 'review answer', steps: 1, completed: true, paused: false, evidence: ['review evidence'] };
                }
                synapse.workerBriefs.push(brief);
                return { answer: 'worker answer', steps: 1, completed: true, paused: false, evidence: ['worker evidence'] };
            },
        } as never;
    };
    return synapse;
}

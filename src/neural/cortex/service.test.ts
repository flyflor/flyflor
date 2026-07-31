import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { WorkspaceBrief } from '@/neural/workspace';
import { Workspace } from '@/neural/workspace';
import { SituationModel } from '@/neural/situation';
import { Cortex } from './service';
import { NeuralSignalType, type CoordinatePlan } from '../types';
import { DispositionRelation } from '../thalamus/types';

describe('NeuralSignalType', () => {
    test('exposes pause and resume as control signals', () => {
        expect(String(NeuralSignalType.Pause)).toBe('pause');
        expect(String(NeuralSignalType.Resume)).toBe('resume');
        expect(String(NeuralSignalType.Ask)).toBe('ask');
        expect(String(NeuralSignalType.Confirm)).toBe('confirm');
    });

    test('exposes coordinate for cortex dispatch', () => {
        expect(String(NeuralSignalType.Coordinate)).toBe('coordinate');
    });
});

describe('Cortex coordinate', () => {
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
        const cortex = coordinateHarness(plan);
        const replies: unknown[] = [];
        cortex.on(NeuralSignalType.Reply, (signal: { data: unknown }) => {
            replies.push(signal.data);
        });

        await (cortex as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(cortex.workerBriefs.map((brief) => brief.goal)).toEqual(['study intent', 'study risk']);
        expect(cortex.workerBriefs.map((brief) => brief.constraints.at(-1))).toEqual(['intent', 'risk']);
        expect(JSON.parse(cortex.seenReviewBrief?.goal ?? '{}')).toMatchObject({ review: 'review all slice results', focus: 'coverage and contradictions' });
        const synthesis = JSON.parse(cortex.synthesisInput) as { outcomes: Array<{ result: string }>; review: { result: string } };
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
        const cortex = coordinateHarness(plan);

        await (cortex as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(cortex.workerBriefs).toHaveLength(1);
        expect(cortex.workerBriefs[0]?.goal).toBe('turn goal');
        expect(cortex.seenReviewBrief).toBeDefined();
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
        const cortex = coordinateHarness(plan);
        const started: string[] = [];
        const gates: Array<() => void> = [];
        let spawns = 0;
        cortex.spawnThought = async () => {
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

        const run = (cortex as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');
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
        const cortex = coordinateHarness(plan);
        let spawns = 0;
        cortex.spawnThought = async () => {
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
        cortex.on(NeuralSignalType.Reply, (signal: { data: unknown }) => {
            replies.push(signal.data);
        });

        await (cortex as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        const synthesis = JSON.parse(cortex.synthesisInput) as { outcomes: Array<{ result: string; failed?: boolean; reason?: string }> };
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
        const cortex = coordinateHarness(plan);
        cortex.spawnThought = async () => ({
            understand: async () => {
                throw Error('boom');
            },
        } as never);

        await expect(
            (cortex as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1'),
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
        const cortex = coordinateHarness(plan);
        const controller = new AbortController();
        cortex.spawnThought = async () => ({
            understand: async (_brief: WorkspaceBrief, signal?: AbortSignal) => {
                await new Promise<never>((_, reject) => {
                    signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
                });
            },
        } as never);

        const run = (cortex as unknown as { coordinate: (chunk: string, turnId: string, signal?: AbortSignal) => Promise<void> })
            .coordinate('latest request', 'turn_1', controller.signal);
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.abort();

        await expect(run).rejects.toThrow('aborted');
    });
});

describe('Cortex cancellation and speaker ownership', () => {
    test('aborts an ingest that has not created a Workspace turn when its speaker disconnects', async () => {
        let receivedSignal: AbortSignal | undefined;
        let release: (() => void) | undefined;
        const brain = {
            next: async (input: unknown) => {
                receivedSignal = (input as { signal?: AbortSignal }).signal;
                await new Promise<void>((resolve) => { release = resolve; });
            },
        };
        const cortex = setupCortex(brain);
        const operation = cortex.attend({ id: 'stim_1', speakerId: 'conn_1', text: 'hello', ts: Date.now() }, {
            relation: DispositionRelation.New,
            urgent: false,
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(receivedSignal?.aborted).toBe(false);
        cortex.forgetSpeaker('conn_1');
        expect(receivedSignal?.aborted).toBe(true);
        release?.();
        await operation;
    });

    test('keeps working turns while removing a disconnected speaker', () => {
        const cortex = setupCortex({ next: async () => undefined });
        cortex.workspace.turns = [
            {
                id: 'turn_waiting', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'wait',
                constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
            },
            {
                id: 'turn_working', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'work',
                constraints: [], refs: [], done: [], open: [], investigate: false, ts: 2,
            },
        ];

        cortex.forgetSpeaker('conn_1');

        expect(cortex.workspace.turns.map((turn) => turn.id)).toEqual(['turn_waiting', 'turn_working']);
    });
});

function setupCortex(brain: { next(input: unknown): Promise<void> }) {
    const cortex = new Cortex(new Workspace(new SituationModel()), {
        preempted: () => false,
        turnSettled: () => undefined,
        turnInterrupted: () => undefined,
        say: () => undefined,
    } as never);
    cortex.brain = brain as never;
    return cortex;
}

function coordinateHarness(plan: CoordinatePlan): Cortex & {
    workerBriefs: WorkspaceBrief[];
    seenReviewBrief?: WorkspaceBrief;
    synthesisInput: string;
} {
    const workspace = {
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
    const cortex = new Cortex(workspace, { preempted: () => false } as never) as Cortex & {
        workerBriefs: WorkspaceBrief[];
        seenReviewBrief?: WorkspaceBrief;
        synthesisInput: string;
    };
    cortex.workerBriefs = [];
    cortex.synthesisInput = '';
    cortex.planPrompt = { section: () => 'plan prompt' } as never;
    cortex.synthesisPrompt = { section: () => 'synthesis prompt' } as never;
    let call = 0;
    cortex.intelligence = {
        completeText: async (messages: Array<{ content: string }>) => {
            call += 1;
            if (call === 1) return JSON.stringify(plan);
            cortex.synthesisInput = messages.at(-1)?.content ?? '';
            return 'final answer';
        },
    } as never;
    let spawned = 0;
    cortex.spawnThought = async () => {
        spawned += 1;
        const index = spawned;
        return {
            understand: async (brief: WorkspaceBrief) => {
                if (index > Math.max(plan.slices.length, 1)) {
                    cortex.seenReviewBrief = brief;
                    return { answer: 'review answer', steps: 1, completed: true, paused: false, evidence: ['review evidence'] };
                }
                cortex.workerBriefs.push(brief);
                return { answer: 'worker answer', steps: 1, completed: true, paused: false, evidence: ['worker evidence'] };
            },
        } as never;
    };
    return cortex;
}

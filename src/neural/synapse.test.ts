import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { AgentBrief } from '@/agent/context';
import { Context } from '@/agent/context';
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
    test('passes slice briefs and temporary personas to workers, then reviews before synthesis', async () => {
        const plan: CoordinatePlan = {
            intent: 'understand the cluster design',
            strategy: 'parallel',
            slices: [
                { profile: 'worker', persona: 'intent analyst', brief: 'study intent', slice: 'intent' },
                { profile: 'worker', persona: 'risk analyst', brief: 'study risk', slice: 'risk' },
            ],
            review: { profile: 'reviewer', persona: 'strict reviewer', brief: 'review all worker results', focus: 'coverage and contradictions' },
            synthesisHint: 'merge and respect review',
        };
        const synapse = coordinateHarness(plan);
        const replies: unknown[] = [];
        synapse.on(SynapseSignalType.Reply, (signal: { data: unknown }) => {
            replies.push(signal.data);
        });

        await (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(synapse.workerBriefs.map((brief) => brief.goal)).toEqual(['study intent', 'study risk']);
        expect(synapse.workerBriefs.map((brief) => brief.persona)).toEqual(['intent analyst', 'risk analyst']);
        expect(synapse.workerBriefs.map((brief) => brief.constraints.at(-1))).toEqual(['intent', 'risk']);
        expect(synapse.seenReviewBrief?.persona).toBe('strict reviewer');
        const synthesis = JSON.parse(synapse.synthesisInput) as { outcomes: Array<{ result: string }>; review: { result: string } };
        expect(synthesis.outcomes.map((outcome) => outcome.result)).toEqual(['worker answer', 'worker answer']);
        expect(synthesis.review.result).toBe('review answer');
        expect(replies).toEqual([{ turnId: 'turn_1', chunk: 'final answer' }, { turnId: 'turn_1', chunk: null }]);
    });

    test('uses the active profile when the plan has no slices and still runs review', async () => {
        const plan: CoordinatePlan = {
            intent: 'single path',
            strategy: 'parallel',
            slices: [],
            review: { profile: 'reviewer', persona: 'single pass reviewer', brief: 'review active result', focus: 'answer quality' },
            synthesisHint: 'summarize active result',
        };
        const synapse = coordinateHarness(plan);

        await (synapse as unknown as { coordinate: (chunk: string, turnId: string) => Promise<void> }).coordinate('latest request', 'turn_1');

        expect(synapse.activeNextCalls).toBe(0);
        expect(synapse.activeUnderstandCalls).toBe(0);
        expect(synapse.workerBriefs).toHaveLength(1);
        expect(synapse.seenReviewBrief?.persona).toBe('single pass reviewer');
    });

    test('runs slices in parallel as unconscious processors', async () => {
        const plan: CoordinatePlan = {
            intent: 'two independent parts',
            strategy: 'parallel',
            slices: [
                { profile: 'worker', persona: 'one', brief: 'study one', slice: 'one' },
                { profile: 'worker', persona: 'two', brief: 'study two', slice: 'two' },
            ],
            review: { profile: 'reviewer', persona: 'reviewer', brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        const started: string[] = [];
        const gates: Array<() => void> = [];
        let spawns = 0;
        synapse.spawnWorker = async () => {
            spawns += 1;
            const isReviewer = spawns > 2;
            return {
                understand: async (brief: AgentBrief) => {
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
                { profile: 'worker', persona: 'healthy', brief: 'study ok', slice: 'ok' },
                { profile: 'worker', persona: 'doomed', brief: 'study fail', slice: 'fail' },
            ],
            review: { profile: 'reviewer', persona: 'reviewer', brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        synapse.spawnWorker = async (profile: string) => {
            if (profile === 'reviewer') {
                return { understand: async () => ({ answer: 'review answer', steps: 1, completed: true, paused: false, evidence: [] }) } as never;
            }
            return {
                understand: async (brief: AgentBrief) => {
                    if (brief.persona === 'doomed') throw Error('worker exploded');
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
                { profile: 'worker', persona: 'one', brief: 'study one', slice: 'one' },
                { profile: 'worker', persona: 'two', brief: 'study two', slice: 'two' },
            ],
            review: { profile: 'reviewer', persona: 'reviewer', brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        synapse.spawnWorker = async () => ({
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
                { profile: 'worker', persona: 'one', brief: 'study one', slice: 'one' },
                { profile: 'worker', persona: 'two', brief: 'study two', slice: 'two' },
            ],
            review: { profile: 'reviewer', persona: 'reviewer', brief: 'review', focus: 'coverage' },
            synthesisHint: 'merge',
        };
        const synapse = coordinateHarness(plan);
        const controller = new AbortController();
        synapse.spawnWorker = async () => ({
            understand: async (_brief: AgentBrief, signal?: AbortSignal) => {
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
    test('aborts an ingest that has not created a Context turn when its speaker disconnects', async () => {
        let receivedSignal: AbortSignal | undefined;
        let release: (() => void) | undefined;
        const agent = {
            next: async (input: unknown) => {
                receivedSignal = (input as { signal?: AbortSignal }).signal;
                await new Promise<void>((resolve) => { release = resolve; });
            },
        };
        const synapse = setupSynapse(agent);
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
        synapse.context.turns = [
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

        expect(synapse.context.turns.map((turn) => turn.id)).toEqual(['turn_waiting', 'turn_working']);
    });
});

function setupSynapse(agent: { next(input: unknown): Promise<void> }) {
    const synapse = new Synapse();
    synapse.agentPool = { main: agent as never };
    synapse.active = 'main';
    synapse.context = new Context();
    synapse.awareness = {
        preempted: () => false,
        turnSettled: () => undefined,
        turnInterrupted: () => undefined,
        say: () => undefined,
    } as never;
    return synapse;
}

function coordinateHarness(plan: CoordinatePlan): Synapse & {
    workerBriefs: AgentBrief[];
    seenReviewBrief?: AgentBrief;
    synthesisInput: string;
    activeNextCalls: number;
    activeUnderstandCalls: number;
} {
    const synapse = new Synapse() as Synapse & {
        workerBriefs: AgentBrief[];
        seenReviewBrief?: AgentBrief;
        synthesisInput: string;
        activeNextCalls: number;
        activeUnderstandCalls: number;
    };
    synapse.workerBriefs = [];
    synapse.synthesisInput = '';
    synapse.activeNextCalls = 0;
    synapse.activeUnderstandCalls = 0;
    synapse.active = 'flyflor';
    synapse.context = {
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
    synapse.agentPool = {
        flyflor: {
            next: async () => {
                synapse.activeNextCalls += 1;
            },
            understand: async () => {
                synapse.activeUnderstandCalls += 1;
                return { answer: 'active answer', steps: 1, completed: true, paused: false, evidence: ['active evidence'] };
            },
        } as never,
    };
    let spawned = 0;
    synapse.spawnWorker = async () => {
        spawned += 1;
        const index = spawned;
        return {
            understand: async (brief: AgentBrief) => {
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

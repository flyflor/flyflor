import { describe, expect, test } from 'bun:test';
import type { AgentBrief } from '@/agent/context';
import { Synapse } from './synapse';
import { SynapseSignalType, type CoordinatePlan } from './types';
import { CallosumSignalType } from '@/agent/brain/callosum';

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

        await (synapse as unknown as { coordinate: (signal: { type: CallosumSignalType; chunk: string }) => Promise<void> }).coordinate({
            type: CallosumSignalType.Coordinate,
            chunk: 'latest request',
        });

        expect(synapse.workerBriefs.map((brief) => brief.goal)).toEqual(['study intent', 'study risk']);
        expect(synapse.workerBriefs.map((brief) => brief.persona)).toEqual(['intent analyst', 'risk analyst']);
        expect(synapse.workerBriefs.map((brief) => brief.constraints.at(-1))).toEqual(['intent', 'risk']);
        expect(synapse.seenReviewBrief?.persona).toBe('strict reviewer');
        const synthesis = JSON.parse(synapse.synthesisInput) as { outcomes: Array<{ result: string }>; review: { result: string } };
        expect(synthesis.outcomes.map((outcome) => outcome.result)).toEqual(['worker answer', 'worker answer']);
        expect(synthesis.review.result).toBe('review answer');
        expect(replies).toEqual(['final answer', null]);
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

        await (synapse as unknown as { coordinate: (signal: { type: CallosumSignalType; chunk: string }) => Promise<void> }).coordinate({
            type: CallosumSignalType.Coordinate,
            chunk: 'latest request',
        });

        expect(synapse.activeNextCalls).toBe(0);
        expect(synapse.activeUnderstandCalls).toBe(1);
        expect(synapse.seenReviewBrief?.persona).toBe('single pass reviewer');
    });
});

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
        brief: (profile: string) => ({
            turnId: 'turn_1',
            intent: 'research',
            goal: `${profile} goal`,
            constraints: [],
            refs: [],
            recentSummaries: [],
        }),
        settle: async () => undefined,
    } as never;
    synapse.planPrompt = { section: () => 'plan prompt' } as never;
    synapse.synthesisPrompt = { section: () => 'synthesis prompt' } as never;
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
                if (index > plan.slices.length) {
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

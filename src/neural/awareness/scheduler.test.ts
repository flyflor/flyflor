import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { Context } from '@/agent/context';
import type { Intelligence } from '@/agent/brain/intelligence';
import type { PromptService } from '@/core';
import { Scheduler, type SchedulerHost } from './scheduler';
import { DispositionRelation, type AttentionInstruction, type ScheduleVerdict, type Stimulus } from './types';

class MockHost implements SchedulerHost {
    public routed: Array<{ stimulus: Stimulus; instruction: AttentionInstruction }> = [];
    public cancelled: string[] = [];
    public errors: Array<{ speakerId: string; message: string }> = [];
    public settled: string[] = [];
    public forgottenSpeakers = new Set<string>();
    private pending: Array<() => void> = [];

    public async route(stimulus: Stimulus, instruction: AttentionInstruction): Promise<void> {
        this.routed.push({ stimulus, instruction });
        await new Promise<void>((resolve) => this.pending.push(resolve));
    }

    public cancel(turnId: string): void {
        this.cancelled.push(turnId);
    }

    public deliverError(speakerId: string, message: string): void {
        this.errors.push({ speakerId, message });
    }

    public forgotten(speakerId: string): boolean {
        return this.forgottenSpeakers.has(speakerId);
    }

    public dispatchSettled(speakerId: string): void {
        this.settled.push(speakerId);
    }

    public release(): void {
        this.pending.shift()?.();
    }
}

function mockScheduler(verdict: ScheduleVerdict = { dispositions: [] }): { scheduler: Scheduler; host: MockHost } {
    const scheduler = new Scheduler();
    scheduler.config = {
        awareness: { scheduleTimeoutMs: 50, batchWindowMs: 0 },
    } as ConfigService;
    scheduler.context = new Context();
    scheduler.prompt = { section: () => 'schedule prompt' } as unknown as PromptService;
    scheduler.intelligence = {
        completeText: async () => JSON.stringify(verdict),
    } as unknown as Intelligence;
    const host = new MockHost();
    scheduler.attach(host);
    return { scheduler, host };
}

const stimulus = (id: string, speakerId: string, text: string): Stimulus => ({ id, speakerId, text, ts: Date.now() });
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Scheduler', () => {
    test('applies backpressure at the configured pending capacity', () => {
        const { scheduler } = mockScheduler();
        scheduler.config = { awareness: { scheduleTimeoutMs: 50, batchWindowMs: 0, pendingCapacity: 1 } } as ConfigService;

        expect(scheduler.enqueue(stimulus('stim_1', 'conn_1', 'a'))).toBe(true);
        expect(scheduler.enqueue(stimulus('stim_2', 'conn_2', 'b'))).toBe(false);
    });

    test('dispatches a single stimulus as a new turn without consulting the advisor', async () => {
        const { scheduler, host } = mockScheduler();
        let consulted = false;
        scheduler.intelligence = {
            completeText: async () => {
                consulted = true;
                return JSON.stringify({ dispositions: [] });
            },
        } as unknown as Intelligence;

        scheduler.enqueue(stimulus('stim_1', 'conn_1', 'hello'));
        await tick();

        expect(consulted).toBe(false);
        expect(host.routed).toHaveLength(1);
        expect(host.routed[0]?.instruction).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('keeps one speaker FIFO when only one speaker is pending', async () => {
        const { scheduler, host } = mockScheduler();
        scheduler.enqueue(stimulus('stim_1', 'conn_1', 'first'));
        await tick();
        scheduler.enqueue(stimulus('stim_2', 'conn_1', 'second'));
        scheduler.enqueue(stimulus('stim_3', 'conn_1', 'third'));
        host.release();
        await tick();
        host.release();
        await tick();

        expect(host.routed.map((entry) => entry.stimulus.text)).toEqual(['first', 'second', 'third']);
    });

    test('round-robins across speakers so a talkative speaker cannot starve others', async () => {
        const { scheduler, host } = mockScheduler();
        scheduler.enqueue(stimulus('stim_1', 'conn_1', 'a1'));
        await tick();
        // conn_1 floods the queue while its first turn is in flight.
        scheduler.enqueue(stimulus('stim_2', 'conn_1', 'a2'));
        scheduler.enqueue(stimulus('stim_3', 'conn_1', 'a3'));
        scheduler.enqueue(stimulus('stim_4', 'conn_2', 'b1'));
        host.release();
        await tick();
        host.release();
        await tick();
        host.release();
        await tick();

        expect(host.routed.map((entry) => entry.stimulus.text)).toEqual(['a1', 'b1', 'a2', 'a3']);
    });

    test('falls back to a new disposition when the advisor times out', async () => {
        const { scheduler, host } = mockScheduler();
        scheduler.context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'completed', intent: 'reply', goal: 'old',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        scheduler.intelligence = {
            completeText: () => new Promise<string>(() => undefined),
        } as unknown as Intelligence;

        scheduler.enqueue(stimulus('stim_1', 'conn_2', 'unclassified'));
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(host.routed).toHaveLength(1);
        expect(host.routed[0]?.instruction).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('marks and cancels only a validated urgent verdict against the foreground', async () => {
        const { scheduler, host } = mockScheduler({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true, targetTurnId: 'turn_1' }],
        });
        scheduler.context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        scheduler.enqueue(stimulus('stim_1', 'conn_2', 'stop'));
        await tick();

        expect(scheduler.preempted('turn_1')).toBe(true);
        expect(host.cancelled).toEqual(['turn_1']);
        expect(host.routed).toHaveLength(0);
    });

    test('rejects a cross-speaker same-turn urgent verdict', async () => {
        const { scheduler, host } = mockScheduler({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.Same, targetTurnId: 'turn_1', urgent: true }],
        });
        scheduler.context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        scheduler.enqueue(stimulus('stim_1', 'conn_2', 'unrelated correction'));
        await tick();

        expect(host.cancelled).toEqual([]);
        expect(scheduler.preempted('turn_1')).toBe(false);
    });

    test('clears the urgent flag when the turn settles', async () => {
        const { scheduler, host } = mockScheduler({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true, targetTurnId: 'turn_1' }],
        });
        scheduler.context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        scheduler.enqueue(stimulus('stim_1', 'conn_2', 'stop'));
        await tick();
        expect(scheduler.preempted('turn_1')).toBe(true);

        scheduler.context.turns[0]!.status = 'suspended';
        scheduler.interrupted('turn_1');

        expect(scheduler.preempted('turn_1')).toBe(false);
    });

    test('delivers workspace backpressure when every semantic slot is protected', async () => {
        const { scheduler, host } = mockScheduler();
        scheduler.context.turns = Array.from({ length: 4 }, (_, index) => ({
            id: `turn_${index + 1}`,
            speakerId: `conn_${index + 1}`,
            status: 'suspended' as const,
            intent: 'reply' as const,
            goal: `goal ${index + 1}`,
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: index + 1,
        }));

        scheduler.enqueue(stimulus('stim_1', 'conn_5', 'new work'));
        await tick();

        expect(host.routed).toHaveLength(0);
        expect(host.errors).toEqual([{ speakerId: 'conn_5', message: Scheduler.WorkspaceBackpressureMessage }]);
    });

    test('includes the master projection in the advisor payload', async () => {
        const { scheduler } = mockScheduler();
        let payload = '';
        scheduler.context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'completed', intent: 'reply', goal: 'old',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        scheduler.context.masterProjection = () => [{ speakerId: 'conn_1', intent: 'reply', goal: 'graduated', result: 'done', remaining: [] }];
        scheduler.intelligence = {
            completeText: async (messages: Array<{ content: string }>) => {
                payload = messages.at(-1)?.content ?? '';
                return JSON.stringify({ dispositions: [] });
            },
        } as unknown as Intelligence;

        scheduler.enqueue(stimulus('stim_1', 'conn_2', 'follow up'));
        await tick();

        expect(JSON.parse(payload)).toMatchObject({ master: [{ goal: 'graduated' }] });
    });
});

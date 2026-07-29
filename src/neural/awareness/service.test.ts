import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { Workspace } from '@/neural/workspace';
import type { Intelligence } from '@/neural/brain/intelligence';
import type { PromptService } from '@/core';
import { Awareness } from './service';
import { Scheduler } from './scheduler';
import { DispositionRelation, type ScheduleVerdict, type Stimulus } from './types';
import type { Synapse } from '@/neural/synapse';
import type { SocketPacket } from '@/neural/ipc';

class MockCortex {
    public attended: Stimulus[] = [];
    public revised: Array<{ stimulus: Stimulus; targetTurnId: string }> = [];
    public cancelled: string[] = [];
    public delivered: Array<{ speakerId: string; packet: SocketPacket }> = [];
    public answers: Array<{ turnId: string; id: string; response: unknown }> = [];
    public pending: Array<{ resolve: () => void }> = [];

    public async attend(stimulus: Stimulus): Promise<void> {
        this.attended.push(stimulus);
        await new Promise<void>((resolve) => this.pending.push({ resolve }));
    }

    public async revise(stimulus: Stimulus, targetTurnId: string): Promise<void> {
        this.revised.push({ stimulus, targetTurnId });
    }

    public cancel(turnId: string): void {
        this.cancelled.push(turnId);
    }

    public deliver(speakerId: string, packet: SocketPacket): void {
        this.delivered.push({ speakerId, packet });
    }

    public answer(turnId: string, id: string, response: unknown): void {
        this.answers.push({ turnId, id, response });
    }

    public release(): void {
        this.pending.shift()?.resolve();
    }
}

function mockAwareness(verdict: ScheduleVerdict = { dispositions: [] }): { awareness: Awareness; scheduler: Scheduler; cortex: MockCortex } {
    const awareness = new Awareness();
    const scheduler = new Scheduler();
    const workspace = new Workspace();
    awareness.config = {
        awareness: { scheduleTimeoutMs: 5000, batchWindowMs: 0 },
    } as ConfigService;
    awareness.workspace = workspace;
    awareness.scheduler = scheduler;
    scheduler.config = awareness.config;
    scheduler.workspace = workspace;
    scheduler.prompt = { section: () => 'schedule prompt' } as unknown as PromptService;
    scheduler.intelligence = {
        completeText: async () => JSON.stringify(verdict),
    } as unknown as Intelligence;
    const cortex = new MockCortex();
    awareness.attend(cortex as unknown as Synapse);
    return { awareness, scheduler, cortex };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Awareness', () => {
    test('dispatches the first stimulus as a new foreground turn', async () => {
        const { awareness, cortex } = mockAwareness();

        awareness.perceive({ speakerId: 'conn_1', text: 'hello' });
        await tick();

        expect(cortex.attended).toHaveLength(1);
        expect(cortex.attended[0]).toMatchObject({ speakerId: 'conn_1', text: 'hello' });
        expect(cortex.attended[0]?.attention).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('keeps the original batch deadline when more stimuli arrive', () => {
        const { scheduler } = mockAwareness();
        scheduler.config = {
            awareness: { scheduleTimeoutMs: 5000, batchWindowMs: 1000 },
        } as ConfigService;

        scheduler.enqueue({ id: 'stim_1', speakerId: 'conn_1', text: 'a', ts: Date.now() });
        const firstTimer = (scheduler as unknown as { batchTimer?: ReturnType<typeof setTimeout> }).batchTimer;
        scheduler.enqueue({ id: 'stim_2', speakerId: 'conn_2', text: 'b', ts: Date.now() });

        expect((scheduler as unknown as { batchTimer?: ReturnType<typeof setTimeout> }).batchTimer).toBe(firstTimer);
        if (firstTimer !== undefined) clearTimeout(firstTimer);
    });

    test('keeps external stimuli serial and FIFO', async () => {
        const { awareness, cortex } = mockAwareness();
        awareness.perceive({ speakerId: 'conn_1', text: 'a' });
        await tick();
        awareness.perceive({ speakerId: 'conn_2', text: 'b' });
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['a']);
        cortex.release();
        await tick();
        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['a', 'b']);
    });

    test('applies explicit backpressure when the transient queue is full', async () => {
        const { awareness, scheduler, cortex } = mockAwareness();
        scheduler.config = {
            awareness: { scheduleTimeoutMs: 5000, batchWindowMs: 0, pendingCapacity: 1 },
        } as ConfigService;

        awareness.perceive({ speakerId: 'conn_1', text: 'active' });
        await tick();
        const queued = awareness.perceive({ speakerId: 'conn_2', text: 'queued' });
        const rejected = awareness.perceive({ speakerId: 'conn_3', text: 'overflow' });

        expect(queued?.text).toBe('queued');
        expect(rejected).toBeUndefined();
        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['active']);
        expect(cortex.delivered.at(-1)).toEqual({
            speakerId: 'conn_3',
            packet: { action: 'error', data: Scheduler.QueueBackpressureMessage },
        });
    });

    test('rejects a new stimulus when all four semantic slots are protected', async () => {
        const { awareness, scheduler, cortex } = mockAwareness();
        awareness.workspace.turns = Array.from({ length: 4 }, (_, index) => ({
            id: `turn_${index + 1}`,
            speakerId: `conn_${index + 1}`,
            status: 'suspended' as const,
            intent: 'reply' as const,
            goal: `goal ${index + 1}`,
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: index + 1,
        }));

        awareness.perceive({ speakerId: 'conn_5', text: 'new work' });
        await tick();

        expect(cortex.attended).toHaveLength(0);
        expect(cortex.delivered.at(-1)).toEqual({
            speakerId: 'conn_5',
            packet: { action: 'error', data: Scheduler.WorkspaceBackpressureMessage },
        });
        expect((scheduler as unknown as { stimuli: Stimulus[] }).stimuli).toHaveLength(0);
    });

    test('revises a same-speaker semantic turn in place', async () => {
        const turn = {
            id: 'turn_1', speakerId: 'conn_1', status: 'completed', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        } as any;
        const { awareness, cortex } = mockAwareness({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.Same, targetTurnId: turn.id }],
        });
        awareness.workspace.turns = [turn];

        awareness.perceive({ speakerId: 'conn_1', text: 'follow up' });
        await tick();

        expect(cortex.revised).toHaveLength(1);
        expect(cortex.revised[0]).toMatchObject({ targetTurnId: 'turn_1', stimulus: { text: 'follow up' } });
    });

    test('falls back to a new Turn when semantic scheduling has no valid verdict', async () => {
        const { awareness, cortex } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'completed', intent: 'reply', goal: 'old goal',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.perceive({ speakerId: 'conn_1', text: 'unclassified request' });
        await tick();

        expect(cortex.revised).toHaveLength(0);
        expect(cortex.attended[0]?.attention).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('marks only an explicit urgent verdict for pre-emption', async () => {
        const { awareness, cortex } = mockAwareness({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true, targetTurnId: 'turn_1' }],
        });
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.perceive({ speakerId: 'conn_2', text: 'stop' });
        await tick();
        expect(awareness.preempted('turn_1')).toBe(true);

        awareness.speak('turn_1', 'conn_1', 'partial');
        awareness.turnInterrupted('turn_1');
        expect(awareness.preempted('turn_1')).toBe(false);
        expect(cortex.delivered.slice(-2).map(({ packet }) => packet.action)).toEqual(['interrupted', 'streamEnd']);
    });

    test('does not let a cross-speaker same-Turn verdict pre-empt its owner', async () => {
        const { awareness, cortex } = mockAwareness({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.Same, targetTurnId: 'turn_1', urgent: true }],
        });
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.perceive({ speakerId: 'conn_2', text: 'unrelated correction' });
        await tick();

        expect(cortex.cancelled).toEqual([]);
        expect(awareness.preempted('turn_1')).toBe(false);
    });

    test('clears a pre-emption flag when settlement is reported by stimulus id', () => {
        const { awareness, scheduler } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', stimulusId: 'stim_1', status: 'completed', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        (scheduler as unknown as { preemptFlags: Set<string> }).preemptFlags.add('turn_1');

        awareness.turnSettled('stim_1');

        expect(awareness.preempted('turn_1')).toBe(false);
    });

    test('allows an explicit urgent stimulus to interrupt a waiting foreground turn', async () => {
        const { awareness, cortex } = mockAwareness({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true }],
        });
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'waiting',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.perceive({ speakerId: 'conn_2', text: 'stop waiting' });
        await tick();

        expect(cortex.cancelled).toEqual(['turn_1']);
        expect(awareness.preempted('turn_1')).toBe(true);
    });

    test('answers are forwarded only for the owning speaker when supplied', () => {
        const { awareness, cortex } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        expect(() => awareness.answer('turn_1', 'ask_1', { kind: 'ask' }, 'conn_2')).toThrow();
        awareness.answer('turn_1', 'ask_1', { kind: 'ask' }, 'conn_1');
        expect(cortex.answers).toHaveLength(1);
    });

    test('forgets a speaker pending in the FIFO queue', async () => {
        const { awareness, cortex } = mockAwareness();
        awareness.perceive({ speakerId: 'conn_1', text: 'a' });
        await tick();
        awareness.perceive({ speakerId: 'conn_2', text: 'b' });
        awareness.forget('conn_2');
        cortex.release();
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.speakerId)).toEqual(['conn_1']);
    });

    test('defers active-turn cleanup until interruption settles', () => {
        const { awareness } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.forget('conn_1');
        expect(awareness.workspace.turns).toHaveLength(1);
        awareness.turnInterrupted('turn_1');
        expect(awareness.workspace.turns).toHaveLength(0);
    });

    test('drops late chunks from a disconnected active speaker before they seize the mouth', () => {
        const { awareness, cortex } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_a', speakerId: 'conn_a', status: 'working', intent: 'reply', goal: 'work',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.forget('conn_a');
        awareness.speak('turn_a', 'conn_a', 'late', 'stim_a');
        awareness.speak('turn_b', 'conn_b', 'next', 'stim_b');
        awareness.speak('turn_b', 'conn_b', null, 'stim_b');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'next' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('serializes mouth chunks and full answers', () => {
        const { awareness, cortex } = mockAwareness();
        awareness.speak('turn_1', 'conn_1', 'one');
        awareness.speak('turn_2', 'conn_2', 'two');
        awareness.speak('turn_1', 'conn_1', null);
        awareness.speak('turn_2', 'conn_2', null);

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'one' },
            { action: 'streamEnd', data: true },
            { action: 'agent', data: 'two' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('reopens a same-Turn mouth for a new stream generation and ignores late old chunks', () => {
        const { awareness, cortex } = mockAwareness();

        awareness.speak('turn_1', 'conn_1', 'old', 'stim_1');
        awareness.speak('turn_1', 'conn_1', null, 'stim_1');
        awareness.speak('turn_1', 'conn_1', 'late old', 'stim_1');
        awareness.speak('turn_1', 'conn_1', 'new', 'stim_2');
        awareness.speak('turn_1', 'conn_1', null, 'stim_2');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'old' },
            { action: 'streamEnd', data: true },
            { action: 'agent', data: 'new' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('releases a waiting speaker mouth when the connection closes', () => {
        const { awareness, cortex } = mockAwareness();
        awareness.workspace.turns = [{
            id: 'turn_a', speakerId: 'conn_a', status: 'waiting', intent: 'reply', goal: 'wait',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.speak('turn_a', 'conn_a', 'partial', 'stim_a');
        awareness.forget('conn_a');
        awareness.speak('turn_b', 'conn_b', 'next', 'stim_b');
        awareness.speak('turn_b', 'conn_b', null, 'stim_b');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'partial' },
            { action: 'agent', data: 'next' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('does not dispatch a stimulus removed while the scheduler is awaiting', async () => {
        const { awareness, scheduler, cortex } = mockAwareness();
        let resolveSchedule!: (value: string) => void;
        awareness.workspace.turns = [{
            id: 'turn_done', speakerId: 'old', status: 'completed', intent: 'reply', goal: 'done',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        scheduler.intelligence = {
            completeText: () => new Promise<string>((resolve) => { resolveSchedule = resolve; }),
        } as unknown as Intelligence;

        awareness.perceive({ speakerId: 'conn_a', text: 'a' });
        awareness.perceive({ speakerId: 'conn_b', text: 'b' });
        await tick();
        awareness.forget('conn_a');
        resolveSchedule(JSON.stringify({ dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New }] }));
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.speakerId)).not.toContain('conn_a');
    });
});

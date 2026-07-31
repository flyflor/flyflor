import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { SituationModel } from '@/neural/situation';
import { Workspace } from '@/neural/workspace';
import type { Intelligence } from '@/neural/brain/intelligence';
import type { PromptService } from '@/core';
import { Thalamus } from './service';
import { Scheduler } from './scheduler';
import { DispositionRelation, type ScheduleVerdict, type Stimulus } from './types';
import type { Cortex } from '@/neural/cortex';
import type { SocketPacket } from '@/neural/sensorimotor';

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

function mockThalamus(verdict: ScheduleVerdict = { dispositions: [] }): { thalamus: Thalamus; scheduler: Scheduler; cortex: MockCortex } {
    const workspace = new Workspace(new SituationModel());
    const scheduler = new Scheduler(workspace);
    const thalamus = new Thalamus(workspace, scheduler);
    thalamus.config = {
        thalamus: { scheduleTimeoutMs: 5000, batchWindowMs: 0 },
    } as ConfigService;
    scheduler.config = thalamus.config;
    scheduler.prompt = { section: () => 'schedule prompt' } as unknown as PromptService;
    scheduler.intelligence = {
        completeText: async () => JSON.stringify(verdict),
    } as unknown as Intelligence;
    const cortex = new MockCortex();
    thalamus.attend(cortex as unknown as Cortex);
    return { thalamus, scheduler, cortex };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Thalamus', () => {
    test('dispatches the first stimulus as a new foreground turn', async () => {
        const { thalamus, cortex } = mockThalamus();

        thalamus.perceive({ speakerId: 'conn_1', text: 'hello' });
        await tick();

        expect(cortex.attended).toHaveLength(1);
        expect(cortex.attended[0]).toMatchObject({ speakerId: 'conn_1', text: 'hello' });
        expect(cortex.attended[0]?.attention).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('keeps the original batch deadline when more stimuli arrive', () => {
        const { scheduler } = mockThalamus();
        scheduler.config = {
            thalamus: { scheduleTimeoutMs: 5000, batchWindowMs: 1000 },
        } as ConfigService;

        scheduler.enqueue({ id: 'stim_1', speakerId: 'conn_1', text: 'a', ts: Date.now() });
        const firstTimer = (scheduler as unknown as { batchTimer?: ReturnType<typeof setTimeout> }).batchTimer;
        scheduler.enqueue({ id: 'stim_2', speakerId: 'conn_2', text: 'b', ts: Date.now() });

        expect((scheduler as unknown as { batchTimer?: ReturnType<typeof setTimeout> }).batchTimer).toBe(firstTimer);
        if (firstTimer !== undefined) clearTimeout(firstTimer);
    });

    test('keeps external stimuli serial and FIFO', async () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.perceive({ speakerId: 'conn_1', text: 'a' });
        await tick();
        thalamus.perceive({ speakerId: 'conn_2', text: 'b' });
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['a']);
        cortex.release();
        await tick();
        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['a', 'b']);
    });

    test('applies explicit backpressure when the transient queue is full', async () => {
        const { thalamus, scheduler, cortex } = mockThalamus();
        scheduler.config = {
            thalamus: { scheduleTimeoutMs: 5000, batchWindowMs: 0, pendingCapacity: 1 },
        } as ConfigService;

        thalamus.perceive({ speakerId: 'conn_1', text: 'active' });
        await tick();
        const queued = thalamus.perceive({ speakerId: 'conn_2', text: 'queued' });
        const rejected = thalamus.perceive({ speakerId: 'conn_3', text: 'overflow' });

        expect(queued?.text).toBe('queued');
        expect(rejected).toBeUndefined();
        expect(cortex.attended.map((stimulus) => stimulus.text)).toEqual(['active']);
        expect(cortex.delivered.at(-1)).toEqual({
            speakerId: 'conn_3',
            packet: { action: 'error', data: Scheduler.QueueBackpressureMessage },
        });
    });

    test('rejects a new stimulus when all four semantic slots are protected', async () => {
        const { thalamus, scheduler, cortex } = mockThalamus();
        thalamus.workspace.turns = Array.from({ length: 4 }, (_, index) => ({
            id: `turn_${index + 1}`,
            speakerId: `conn_${index + 1}`,
            status: 'suspended' as const,
            intent: 'reply' as const,
            goal: `goal ${index + 1}`,
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: index + 1,
        }));

        thalamus.perceive({ speakerId: 'conn_5', text: 'new work' });
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
        const { thalamus, cortex } = mockThalamus({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.Same, targetTurnId: turn.id }],
        });
        thalamus.workspace.turns = [turn];

        thalamus.perceive({ speakerId: 'conn_1', text: 'follow up' });
        await tick();

        expect(cortex.revised).toHaveLength(1);
        expect(cortex.revised[0]).toMatchObject({ targetTurnId: 'turn_1', stimulus: { text: 'follow up' } });
    });

    test('falls back to a new Turn when semantic scheduling has no valid verdict', async () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'completed', intent: 'reply', goal: 'old goal',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.perceive({ speakerId: 'conn_1', text: 'unclassified request' });
        await tick();

        expect(cortex.revised).toHaveLength(0);
        expect(cortex.attended[0]?.attention).toMatchObject({ relation: DispositionRelation.New, urgent: false });
    });

    test('marks only an explicit urgent verdict for pre-emption', async () => {
        const { thalamus, cortex } = mockThalamus({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true, targetTurnId: 'turn_1' }],
        });
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.perceive({ speakerId: 'conn_2', text: 'stop' });
        await tick();
        expect(thalamus.preempted('turn_1')).toBe(true);

        thalamus.speak('turn_1', 'conn_1', 'partial');
        thalamus.turnInterrupted('turn_1');
        expect(thalamus.preempted('turn_1')).toBe(false);
        expect(cortex.delivered.slice(-2).map(({ packet }) => packet.action)).toEqual(['interrupted', 'streamEnd']);
    });

    test('does not let a cross-speaker same-Turn verdict pre-empt its owner', async () => {
        const { thalamus, cortex } = mockThalamus({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.Same, targetTurnId: 'turn_1', urgent: true }],
        });
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.perceive({ speakerId: 'conn_2', text: 'unrelated correction' });
        await tick();

        expect(cortex.cancelled).toEqual([]);
        expect(thalamus.preempted('turn_1')).toBe(false);
    });

    test('clears a pre-emption flag when settlement is reported by stimulus id', () => {
        const { thalamus, scheduler } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', stimulusId: 'stim_1', status: 'completed', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        (scheduler as unknown as { preemptFlags: Set<string> }).preemptFlags.add('turn_1');

        thalamus.turnSettled('stim_1');

        expect(thalamus.preempted('turn_1')).toBe(false);
    });

    test('allows an explicit urgent stimulus to interrupt a waiting foreground turn', async () => {
        const { thalamus, cortex } = mockThalamus({
            dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New, urgent: true }],
        });
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'waiting',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.perceive({ speakerId: 'conn_2', text: 'stop waiting' });
        await tick();

        expect(cortex.cancelled).toEqual(['turn_1']);
        expect(thalamus.preempted('turn_1')).toBe(true);
    });

    test('answers are forwarded only for the owning speaker when supplied', () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'waiting', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        expect(() => thalamus.answer('turn_1', 'ask_1', { kind: 'ask' }, 'conn_2')).toThrow();
        thalamus.answer('turn_1', 'ask_1', { kind: 'ask' }, 'conn_1');
        expect(cortex.answers).toHaveLength(1);
    });

    test('forgets a speaker pending in the FIFO queue', async () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.perceive({ speakerId: 'conn_1', text: 'a' });
        await tick();
        thalamus.perceive({ speakerId: 'conn_2', text: 'b' });
        thalamus.forget('conn_2');
        cortex.release();
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.speakerId)).toEqual(['conn_1']);
    });

    test('defers active-turn cleanup until interruption settles', () => {
        const { thalamus } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.forget('conn_1');
        expect(thalamus.workspace.turns).toHaveLength(1);
        thalamus.turnInterrupted('turn_1');
        expect(thalamus.workspace.turns).toHaveLength(0);
    });

    test('drops late chunks from a disconnected active speaker before they seize the mouth', () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_a', speakerId: 'conn_a', status: 'working', intent: 'reply', goal: 'work',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.forget('conn_a');
        thalamus.speak('turn_a', 'conn_a', 'late', 'stim_a');
        thalamus.speak('turn_b', 'conn_b', 'next', 'stim_b');
        thalamus.speak('turn_b', 'conn_b', null, 'stim_b');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'next' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('serializes mouth chunks and full answers', () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.speak('turn_1', 'conn_1', 'one');
        thalamus.speak('turn_2', 'conn_2', 'two');
        thalamus.speak('turn_1', 'conn_1', null);
        thalamus.speak('turn_2', 'conn_2', null);

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'one' },
            { action: 'streamEnd', data: true },
            { action: 'agent', data: 'two' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('reopens a same-Turn mouth for a new stream generation and ignores late old chunks', () => {
        const { thalamus, cortex } = mockThalamus();

        thalamus.speak('turn_1', 'conn_1', 'old', 'stim_1');
        thalamus.speak('turn_1', 'conn_1', null, 'stim_1');
        thalamus.speak('turn_1', 'conn_1', 'late old', 'stim_1');
        thalamus.speak('turn_1', 'conn_1', 'new', 'stim_2');
        thalamus.speak('turn_1', 'conn_1', null, 'stim_2');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'old' },
            { action: 'streamEnd', data: true },
            { action: 'agent', data: 'new' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('releases a waiting speaker mouth when the connection closes', () => {
        const { thalamus, cortex } = mockThalamus();
        thalamus.workspace.turns = [{
            id: 'turn_a', speakerId: 'conn_a', status: 'waiting', intent: 'reply', goal: 'wait',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        thalamus.speak('turn_a', 'conn_a', 'partial', 'stim_a');
        thalamus.forget('conn_a');
        thalamus.speak('turn_b', 'conn_b', 'next', 'stim_b');
        thalamus.speak('turn_b', 'conn_b', null, 'stim_b');

        expect(cortex.delivered.map(({ packet }) => packet)).toEqual([
            { action: 'agent', data: 'partial' },
            { action: 'agent', data: 'next' },
            { action: 'streamEnd', data: true },
        ]);
    });

    test('does not dispatch a stimulus removed while the scheduler is awaiting', async () => {
        const { thalamus, scheduler, cortex } = mockThalamus();
        let resolveSchedule!: (value: string) => void;
        thalamus.workspace.turns = [{
            id: 'turn_done', speakerId: 'old', status: 'completed', intent: 'reply', goal: 'done',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];
        scheduler.intelligence = {
            completeText: () => new Promise<string>((resolve) => { resolveSchedule = resolve; }),
        } as unknown as Intelligence;

        thalamus.perceive({ speakerId: 'conn_a', text: 'a' });
        thalamus.perceive({ speakerId: 'conn_b', text: 'b' });
        await tick();
        thalamus.forget('conn_a');
        resolveSchedule(JSON.stringify({ dispositions: [{ stimulusId: 'stim_1', relation: DispositionRelation.New }] }));
        await tick();

        expect(cortex.attended.map((stimulus) => stimulus.speakerId)).not.toContain('conn_a');
    });
});

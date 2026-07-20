import 'reflect-metadata';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { ConfigService } from '@/configuration';
import { Context } from '@/agent/context';
import type { Intelligence } from '@/agent/brain/intelligence';
import type { PromptService } from '@/core';
import { Awareness } from './service';
import { DispositionAction, type ScheduleVerdict, type Stimulus } from './types';
import type { Synapse } from '@/neural/synapse';
import type { SocketPacket } from '@/neural/ipc';

class MockCortex {
    public attended: Stimulus[] = [];
    public pondered: Stimulus[] = [];
    public delivered: Array<{ speakerId: string; packet: SocketPacket }> = [];
    public answers: Array<{ turnId: string; id: string; response: unknown }> = [];

    public async attend(stimulus: Stimulus): Promise<void> {
        this.attended.push(stimulus);
    }

    public async ponder(stimulus: Stimulus): Promise<void> {
        this.pondered.push(stimulus);
    }

    public deliver(speakerId: string, packet: SocketPacket): void {
        this.delivered.push({ speakerId, packet });
    }

    public answer(turnId: string, id: string, response: unknown): void {
        this.answers.push({ turnId, id, response });
    }
}

function mockAwareness(overrides: Partial<Awareness> = {}): { awareness: Awareness; cortex: MockCortex } {
    const awareness = new Awareness();
    awareness.config = {
        awareness: { maxConcurrentThoughts: 2, scheduleTimeoutMs: 5000, batchWindowMs: 0 },
    } as ConfigService;
    awareness.context = new Context();
    awareness.prompt = { section: () => 'schedule prompt' } as unknown as PromptService;
    awareness.intelligence = {
        completeText: async () => JSON.stringify({ dispositions: [] }),
    } as unknown as Intelligence;
    Object.assign(awareness, overrides);
    const cortex = new MockCortex();
    awareness.attend(cortex as unknown as Synapse);
    return { awareness, cortex };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Awareness', () => {
    test('perceives a stimulus and dispatches the only idle thought immediately', async () => {
        const { awareness, cortex } = mockAwareness();

        awareness.perceive({ speakerId: 'conn_1', text: 'hello' });
        await tick();

        expect(cortex.attended).toHaveLength(1);
        expect(cortex.attended[0]).toMatchObject({ speakerId: 'conn_1', text: 'hello' });
    });

    test('answers bypass the scheduler and go straight to the cortex', () => {
        const { awareness, cortex } = mockAwareness();
        awareness.answer('turn_1', 'ask_1', { kind: 'ask', answers: [] });

        expect(cortex.answers).toEqual([{ turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask', answers: [] } }]);
    });

    test('forgets a speaker and drops their pending stimuli', async () => {
        const { awareness, cortex } = mockAwareness();
        awareness.perceive({ speakerId: 'conn_1', text: 'a' });
        awareness.perceive({ speakerId: 'conn_2', text: 'b' });
        awareness.forget('conn_1');
        await tick();

        expect(cortex.attended.map((s) => s.speakerId)).not.toContain('conn_1');
        expect(cortex.attended.map((s) => s.speakerId)).toContain('conn_2');
    });

    test('mouth lets one turn stream at a time and buffers others', () => {
        const { awareness, cortex } = mockAwareness();

        awareness.speak('turn_1', 'conn_1', 'one');
        awareness.speak('turn_2', 'conn_2', 'two');
        awareness.speak('turn_1', 'conn_1', null);
        awareness.speak('turn_2', 'conn_2', null);

        expect(cortex.delivered).toEqual([
            { speakerId: 'conn_1', packet: { action: 'agent', data: 'one' } },
            { speakerId: 'conn_1', packet: { action: 'streamEnd', data: true } },
            { speakerId: 'conn_2', packet: { action: 'agent', data: 'two' } },
            { speakerId: 'conn_2', packet: { action: 'streamEnd', data: true } },
        ]);
    });

    test('say queues full answers behind the current mouth', () => {
        const { awareness, cortex } = mockAwareness();

        awareness.speak('turn_1', 'conn_1', 'hello');
        awareness.say('conn_2', 'later');
        awareness.speak('turn_1', 'conn_1', null);

        expect(cortex.delivered.slice(-2)).toEqual([
            { speakerId: 'conn_2', packet: { action: 'agent', data: 'later' } },
            { speakerId: 'conn_2', packet: { action: 'streamEnd', data: true } },
        ]);
    });

    test('sets and clears preempt flags', async () => {
        const { awareness } = mockAwareness({
            intelligence: {
                completeText: async (messages: Array<{ role: string; content: string }>) => {
                    return JSON.stringify({
                        dispositions: [{
                            stimulusId: 'stim_1',
                            action: DispositionAction.Preempt,
                            targetTurnId: 'turn_1',
                            priority: 30,
                        }],
                    } as ScheduleVerdict);
                },
            } as unknown as Intelligence,
        });
        const context = awareness.context as Context;
        context.turns = [{
            id: 'turn_1', speakerId: 'conn_1', status: 'working', intent: 'reply', goal: 'g', user: 'u',
            constraints: [], refs: [], done: [], open: [], investigate: false, ts: 1,
        }];

        awareness.perceive({ speakerId: 'conn_2', text: 'stop!' });
        await tick();
        await tick();
        await tick();

        expect(awareness.preempted('turn_1')).toBe(true);
        awareness.turnInterrupted('turn_1');
        expect(awareness.preempted('turn_1')).toBe(false);
    });
});

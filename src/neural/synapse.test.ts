import { describe, expect, test } from 'bun:test';
import { Context, type CompleteSignal } from '@/agent';
import { ConfigService } from '@/config';
import { Observable, useContainer } from '@/core';
import type { SocketCallbacks } from '@/transport';
import { Synapse } from './synapse';
import type { ExpressionSignal, InteractionSignal } from './types';

/** EN: Creates one wired cortex with an observable fake transport. ZH: 使用可观察 fake transport 创建一个已连接皮层。 */
async function harness() {
    const packets: Array<{ action: string; data: unknown }> = [];
    let callbacks: SocketCallbacks | undefined;
    const synapse = useContainer().create(Synapse);
    synapse.config = await useContainer().getAsync(ConfigService);
    synapse.context = useContainer().create(Context);
    synapse.sensory = useContainer().create(Observable<string>, 'sensory-test');
    synapse.interaction = useContainer().create(Observable<InteractionSignal>, 'interaction-test');
    synapse.delegation = useContainer().create(Observable, 'delegation-test') as never;
    synapse.expression = useContainer().create(Observable<ExpressionSignal>, 'expression-test');
    synapse.socket = {
        bind: (value: SocketCallbacks) => { callbacks = value; },
        write: (packet: { action: string; data: unknown }) => { packets.push(packet); },
    } as never;
    await synapse.init();
    return { synapse, packets, callbacks: () => callbacks };
}

describe('Synapse', () => {
    test('reuses persistent Agent scopes and isolates their Memory', async () => {
        const { synapse } = await harness();

        const first = await synapse.spawnAgent('worker');
        const again = await synapse.spawnAgent('worker');
        const reviewer = await synapse.spawnAgent('reviewer');

        expect(first).toBe(again);
        expect(first.brain.memory).toBe(again.brain.memory);
        expect(first.brain.memory).not.toBe(reviewer.brain.memory);
    });

    test('serializes exact Ask responses independently from delegation', async () => {
        const { synapse, packets } = await harness();
        const brief = synapse.context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        const responsePromise = synapse.fire({
            type: 'ask',
            turnId: brief.turnId,
            id: 'ask_1',
            agent: 'worker',
            questions: [{ question: 'Scope?', options: [{ label: 'one' }] }],
        });
        await Promise.resolve();
        synapse.answer(brief.turnId, 'ask_1', { kind: 'ask', answers: [{ question: 'Scope?', answer: 'one' }] });

        expect(await responsePromise).toEqual({ kind: 'ask', answers: [{ question: 'Scope?', answer: 'one' }] });
        expect(packets.map((packet) => packet.action)).toEqual(['ask', 'pause', 'resume']);
    });

    test('dispatches different Agents concurrently and returns correlated Completes', async () => {
        const { synapse } = await harness();
        const brief = synapse.context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        let active = 0;
        let maximum = 0;
        synapse.spawnAgent = async (name: string) => ({
            receive: async (stimulus: { task: { id: string; turnId: string } }) => {
                active += 1;
                maximum = Math.max(maximum, active);
                await Promise.resolve();
                active -= 1;
                return { type: 'complete', id: stimulus.task.id, turnId: stimulus.task.turnId, agent: name, answer: `${name} answer`, evidence: [] } as CompleteSignal;
            },
        }) as never;

        const completes = await synapse.fire({
            type: 'task',
            turnId: brief.turnId,
            id: 'task_1',
            agent: 'flyflor',
            tasks: [{ agent: 'worker', goal: 'one' }, { agent: 'reviewer', goal: 'two' }],
        });

        expect(maximum).toBe(2);
        expect(completes.map((complete) => complete.id)).toEqual(['task_1:1', 'task_1:2']);
    });

    test('orders reply, Complete, and stream end on one expression circuit', async () => {
        const { synapse, packets } = await harness();

        await synapse.fire({ type: 'reply', turnId: 'turn_1', agent: 'flyflor', chunk: 'hello' });
        await synapse.fire({ type: 'complete', id: 'turn_1', turnId: 'turn_1', agent: 'flyflor', answer: 'hello', evidence: [] });

        expect(packets.map((packet) => packet.action)).toEqual(['agent', 'complete', 'streamEnd']);
    });

    test('keeps interaction live while delegation is waiting', async () => {
        const { synapse } = await harness();
        const brief = synapse.context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        synapse.spawnAgent = async () => ({
            receive: async (stimulus: { task: { id: string; turnId: string } }) => {
                await gate;
                return { type: 'complete', id: stimulus.task.id, turnId: stimulus.task.turnId, agent: 'worker', answer: 'done', evidence: [] } as CompleteSignal;
            },
        }) as never;
        const delegated = synapse.fire({
            type: 'task',
            turnId: brief.turnId,
            id: 'task_waiting',
            agent: 'flyflor',
            tasks: [{ agent: 'worker', goal: 'wait' }],
        });
        const interaction = synapse.fire({
            type: 'confirm',
            turnId: brief.turnId,
            id: 'confirm_live',
            agent: 'worker',
            call: { id: 'call_1', name: 'shell', arguments: { command: 'true' } },
        });
        await Promise.resolve();
        synapse.answer(brief.turnId, 'confirm_live', { kind: 'confirm', approved: true });

        expect(await interaction).toEqual({ kind: 'confirm', approved: true });
        release();
        expect((await delegated)[0]?.answer).toBe('done');
    });
});

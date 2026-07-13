import { describe, expect, test } from 'bun:test';
import { Context, type CompleteSignal } from '@/agent';
import { ConfigService } from '@/config';
import { useContainer } from '@/core';
import type { SocketCallbacks } from '@/transport';
import { Delegation } from './delegation';
import { Expression } from './expression';
import { Interaction } from './interaction';
import { AgentPool } from './pool';
import { Sensory } from './sensory';
import { Synapse } from './synapse';

/** EN: Creates one wired cortex with an observable fake transport. ZH: 使用可观察 fake transport 创建一个已连接皮层。 */
async function harness() {
    const packets: Array<{ action: string; data: unknown }> = [];
    let callbacks: SocketCallbacks | undefined;
    let online = true;
    const socket = {
        get connected() { return online; },
        bind: async (value: SocketCallbacks) => {
            callbacks = value;
            if (online) await value.connected();
        },
        write: (packet: { action: string; data: unknown }) => {
            if (!online) throw Error('Socket connection is unavailable');
            packets.push(packet);
        },
    } as never;
    const context = useContainer().create(Context);
    const pool = useContainer().create(AgentPool);
    pool.config = await useContainer().getAsync(ConfigService);
    pool.init();
    const sensory = useContainer().create(Sensory);
    const interaction = useContainer().create(Interaction);
    interaction.context = context;
    interaction.socket = socket;
    interaction.init();
    const delegation = useContainer().create(Delegation);
    delegation.context = context;
    const expression = useContainer().create(Expression);
    expression.socket = socket;
    expression.init();
    const synapse = useContainer().create(Synapse);
    Object.assign(synapse, { pool, sensory, interaction, delegation, expression, socket });
    await synapse.init();
    return {
        synapse,
        pool,
        context,
        packets,
        callbacks: () => callbacks,
        disconnect: () => { online = false; },
        connect: async () => {
            online = true;
            if (!callbacks) throw Error('Socket callbacks are missing');
            await callbacks.connected();
        },
    };
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

    test('keeps stimuli for the same Agent FIFO ordered', async () => {
        const { synapse } = await harness();
        const agent = await synapse.spawnAgent('worker');
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        agent.brain.receive = async (stimulus) => {
            const input = stimulus.type === 'input' ? stimulus.input : stimulus.task.goal;
            order.push(`start:${input}`);
            if (input === 'one') await gate;
            order.push(`end:${input}`);
            return { type: 'complete', id: input, turnId: 'turn_fifo', agent: 'worker', answer: input, evidence: [] };
        };

        const first = agent.receive({ type: 'input', input: 'one' });
        const second = agent.receive({ type: 'input', input: 'two' });
        await Promise.resolve();
        expect(order).toEqual(['start:one']);
        release();
        await Promise.all([first, second]);

        expect(order).toEqual(['start:one', 'end:one', 'start:two', 'end:two']);
    });

    test('serializes exact Ask responses independently from delegation', async () => {
        const { synapse, context, packets } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
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

    test('rejects mismatched and invalid interaction answers before resuming', async () => {
        const { synapse, context, packets } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        const responsePromise = synapse.fire({
            type: 'confirm',
            turnId: brief.turnId,
            id: 'confirm_1',
            agent: 'worker',
            call: { id: 'call_1', name: 'shell', arguments: { command: 'true' } },
        });
        await Promise.resolve();

        expect(() => synapse.answer(brief.turnId, 'wrong', { kind: 'confirm', approved: true })).toThrow('does not match');
        expect(() => synapse.answer(brief.turnId, 'confirm_1', { kind: 'ask', answers: [] })).toThrow('Confirm response is invalid');
        expect(packets.map((packet) => packet.action)).toEqual(['confirm', 'pause']);

        synapse.answer(brief.turnId, 'confirm_1', { kind: 'confirm', approved: false });
        expect(await responsePromise).toEqual({ kind: 'confirm', approved: false });
        expect(packets.map((packet) => packet.action)).toEqual(['confirm', 'pause', 'resume']);
    });

    test('dispatches different Agents concurrently and returns correlated Completes', async () => {
        const { synapse, pool, context } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        let active = 0;
        let maximum = 0;
        pool.spawn = async (name: string) => ({
            receive: async (stimulus: { task: { id: string; context: { turnId: string } } }) => {
                active += 1;
                maximum = Math.max(maximum, active);
                await Promise.resolve();
                active -= 1;
                return { type: 'complete', id: stimulus.task.id, turnId: stimulus.task.context.turnId, agent: name, answer: `${name} answer`, evidence: [] } as CompleteSignal;
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

    test('rejects self-delegation before dispatching an Agent task', async () => {
        const { synapse, context } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });

        await expect(synapse.fire({
            type: 'task',
            turnId: brief.turnId,
            id: 'task_self',
            agent: 'worker',
            tasks: [{ agent: 'worker', goal: 'deadlock' }],
        })).rejects.toThrow('Agent cannot delegate to itself');
    });

    test('orders reply, Complete, and stream end on one expression circuit', async () => {
        const { synapse, packets } = await harness();

        await synapse.fire({ type: 'reply', turnId: 'turn_1', agent: 'flyflor', chunk: 'hello' });
        await synapse.fire({ type: 'complete', id: 'turn_1', turnId: 'turn_1', agent: 'flyflor', answer: 'hello', evidence: [] });

        expect(packets.map((packet) => packet.action)).toEqual(['agent', 'complete', 'streamEnd']);
    });

    test('keeps interaction live while delegation is waiting', async () => {
        const { synapse, pool, context } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        pool.spawn = async () => ({
            receive: async (stimulus: { task: { id: string; context: { turnId: string } } }) => {
                await gate;
                return { type: 'complete', id: stimulus.task.id, turnId: stimulus.task.context.turnId, agent: 'worker', answer: 'done', evidence: [] } as CompleteSignal;
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

    test('awaits the complete sensory path from the transport callback', async () => {
        const { synapse, callbacks } = await harness();
        let finished = false;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        synapse.agent.brain.receive = async () => {
            await gate;
            finished = true;
            return { type: 'complete', id: 'input', turnId: 'turn_input', agent: 'flyflor', answer: 'done', evidence: [] };
        };
        const input = callbacks()?.input('root input');
        if (!input) throw Error('Sensory callback is missing');
        await Promise.resolve();
        expect(finished).toBe(false);
        release();
        await input;

        expect(finished).toBe(true);
    });

    test('keeps an offline Ask pending and replays it after reconnect', async () => {
        const { synapse, context, packets, disconnect, connect } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        disconnect();

        const response = synapse.fire({
            type: 'ask',
            turnId: brief.turnId,
            id: 'ask_reconnect',
            agent: 'worker',
            questions: [{ question: 'Continue?', options: [{ label: 'yes' }] }],
        });
        await Promise.resolve();
        expect(packets).toEqual([]);

        await connect();
        expect(packets.map((packet) => packet.action)).toEqual(['ask', 'pause']);
        synapse.answer(brief.turnId, 'ask_reconnect', { kind: 'ask', answers: [{ question: 'Continue?', answer: 'yes' }] });

        expect(await response).toEqual({ kind: 'ask', answers: [{ question: 'Continue?', answer: 'yes' }] });
        expect(packets.map((packet) => packet.action)).toEqual(['ask', 'pause', 'resume']);
    });

    test('retains pending Confirm state when resume cannot be written', async () => {
        const { synapse, context, packets, disconnect, connect } = await harness();
        const brief = context.begin('root', { intent: 'research', goal: 'inspect', constraints: [], references: [] });
        const response = synapse.fire({
            type: 'confirm',
            turnId: brief.turnId,
            id: 'confirm_reconnect',
            agent: 'worker',
            call: { id: 'call_reconnect', name: 'shell', arguments: { command: 'true' } },
        });
        await Promise.resolve();
        disconnect();

        expect(() => synapse.answer(brief.turnId, 'confirm_reconnect', { kind: 'confirm', approved: true })).toThrow('connection is unavailable');
        await connect();
        expect(packets.map((packet) => packet.action)).toEqual(['confirm', 'pause', 'confirm', 'pause']);

        synapse.answer(brief.turnId, 'confirm_reconnect', { kind: 'confirm', approved: true });
        expect(await response).toEqual({ kind: 'confirm', approved: true });
        expect(packets.map((packet) => packet.action)).toEqual(['confirm', 'pause', 'confirm', 'pause', 'resume']);
    });
});

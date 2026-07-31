import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { ConfigService, FPopulationConfiguration } from '@/configuration';
import { useContainer } from '@/core';
import { FSocket } from '@/neural/sensorimotor';
import { Agent } from './agent';
import { AgentManager } from './manager';
import { AgentProfile, type PopulationRouter } from './types';

class FakeAgent {
    public perceived: Array<{ speakerId: string; text: string }> = [];
    public answered: unknown[] = [];
    public forgotten: string[] = [];

    constructor(public readonly profile: AgentProfile) {}

    public get id(): string {
        return this.profile.id;
    }

    public perceive(input: { speakerId: string; text: string }): unknown {
        this.perceived.push(input);
        return input;
    }

    public answer(turnId: string, id: string, response: unknown, speakerId?: string): void {
        this.answered.push({ turnId, id, response, speakerId });
    }

    public forget(speakerId: string): void {
        this.forgotten.push(speakerId);
    }
}

function mockManager(population: FPopulationConfiguration) {
    const manager = new AgentManager();
    manager.config = { population } as ConfigService;
    const attached: PopulationRouter[] = [];
    manager.socket = { attachRouter: (router: PopulationRouter) => attached.push(router) } as unknown as FSocket;
    const spawned = new Map<string, FakeAgent>();
    manager.spawnAgent = async (profile: AgentProfile) => {
        const agent = new FakeAgent(profile);
        spawned.set(profile.id, agent);
        return agent as unknown as Agent;
    };
    return { manager, attached, spawned };
}

describe('AgentManager', () => {
    test('routes an unbound speaker to the main agent', async () => {
        const { manager, attached, spawned } = mockManager({ main: 'main', capacity: 8, agents: [{ id: 'main' }, { id: 'planner' }] });

        await manager.init();
        manager.perceive({ speakerId: 'conn_1', text: 'hello' });

        expect(attached[0]).toBe(manager);
        expect([...manager.agents.keys()]).toEqual(['main', 'planner']);
        expect(spawned.get('main')?.perceived).toEqual([{ speakerId: 'conn_1', text: 'hello' }]);
        expect(spawned.get('planner')?.perceived).toEqual([]);
    });

    test('rebinds a speaker to another agent and rejects unknown agent ids', async () => {
        const { manager, spawned } = mockManager({ main: 'main', capacity: 8, agents: [{ id: 'main' }, { id: 'planner' }] });
        await manager.init();

        expect(manager.route('conn_1', 'ghost')).toBe(false);
        expect(manager.route('conn_1', 'planner')).toBe(true);
        manager.perceive({ speakerId: 'conn_1', text: 'hi' });

        expect(spawned.get('planner')?.perceived).toEqual([{ speakerId: 'conn_1', text: 'hi' }]);
        expect(spawned.get('main')?.perceived).toEqual([]);
    });

    test('forget clears the binding and forwards to the bound agent', async () => {
        const { manager, spawned } = mockManager({ main: 'main', capacity: 8, agents: [{ id: 'main' }, { id: 'planner' }] });
        await manager.init();
        manager.route('conn_1', 'planner');

        manager.forget('conn_1');

        expect(manager.bindings.has('conn_1')).toBe(false);
        expect(spawned.get('planner')?.forgotten).toEqual(['conn_1']);
        manager.perceive({ speakerId: 'conn_1', text: 'again' });
        expect(spawned.get('main')?.perceived).toEqual([{ speakerId: 'conn_1', text: 'again' }]);
    });

    test('routes answers to the currently bound agent', async () => {
        const { manager, spawned } = mockManager({ main: 'main', capacity: 8, agents: [{ id: 'main' }, { id: 'planner' }] });
        await manager.init();
        manager.route('conn_1', 'planner');

        manager.answer('turn_1', 'ask_1', { kind: 'ask' }, 'conn_1');

        expect(spawned.get('planner')?.answered).toEqual([{ turnId: 'turn_1', id: 'ask_1', response: { kind: 'ask' }, speakerId: 'conn_1' }]);
        expect(spawned.get('main')?.answered).toEqual([]);
    });

    test('truncates configured agents beyond capacity with a warning', async () => {
        const { manager } = mockManager({ main: 'main', capacity: 2, agents: [{ id: 'main' }, { id: 'planner' }, { id: 'ghost' }] });
        const warnings: Array<{ event: string; data: unknown }> = [];
        Object.defineProperty(manager, 'log', { value: { warn: (event: string, data: unknown) => warnings.push({ event, data }) } });

        await manager.init();

        expect([...manager.agents.keys()]).toEqual(['main', 'planner']);
        expect(warnings).toEqual([{ event: 'population.capacity', data: { id: 'ghost', capacity: 2 } }]);
    });

    test('skips duplicate agent ids while filling capacity', async () => {
        const { manager } = mockManager({ main: 'main', capacity: 2, agents: [{ id: 'main' }, { id: 'main' }, { id: 'planner' }] });

        await manager.init();

        expect([...manager.agents.keys()]).toEqual(['main', 'planner']);
    });

    test('builds isolated per-agent stacks over the shared transport in the real container', async () => {
        useContainer().registerObject(FSocket, { attachRouter: () => undefined });
        const a = await useContainer().getAsync(Agent, useContainer().create(AgentProfile, 'a'));
        const b = await useContainer().getAsync(Agent, useContainer().create(AgentProfile, 'b'));

        expect(a.situation).not.toBe(b.situation);
        expect(a.workspace).not.toBe(b.workspace);
        expect(a.scheduler).not.toBe(b.scheduler);
        expect(a.thalamus).not.toBe(b.thalamus);
        expect(a.cortex).not.toBe(b.cortex);
        expect(a.cortex.socket).toBe(b.cortex.socket);
        expect(a.cortex.workspace).toBe(a.workspace);
        expect(a.cortex.thalamus).toBe(a.thalamus);
        expect(a.cortex.profile?.id).toBe('a');
        expect(b.cortex.profile?.id).toBe('b');
        expect(a.cortex.brain.workspace).toBe(a.workspace);
        expect(a.cortex.brain.scratchpad.profile?.id).toBe('a');
        expect(b.cortex.brain.scratchpad.profile?.id).toBe('b');
        expect(a.cortex.brain.investigation.workspace).toBe(a.workspace);
        expect(a.workspace.situation).toBe(a.situation);
        expect(a.scheduler.workspace).toBe(a.workspace);
        expect(a.thalamus.workspace).toBe(a.workspace);
        expect(a.thalamus.scheduler).toBe(a.scheduler);
    });
});

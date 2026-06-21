import { Agent } from '@/agent';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, Scope, useContainer, type CortexSignal } from '@/core';
import { FSocket } from './ipc';
import type { Context } from './context';

export interface AgentPool {
    active: string;
    agents: { [name: string]: Agent };
}

export enum SynapseSignalType {
    Input = 'input',
    Reply = 'reply',
    Event = 'event',
    Ask = 'ask',
    Confirm = 'confirm',
}

export interface SynapseSignal extends CortexSignal {
    type: SynapseSignalType;
}

@Module()
export class Synapse extends FCortex<SynapseSignal> {
    @Config()
    public readonly config!: ConfigService;

    @Inject()
    public context!: Context;

    @Scope()
    public socket!: FSocket;

    public agentPool: AgentPool;

    public get agent() {
        return this.agentPool.agents[this.agentPool.active]!;
    }

    constructor() {
        super();
        this.agentPool = { active: '', agents: {} };
    }

    /**
     * Spawns the master agent from the configured `activeAgent` profile and logs the runtime as
     * ready. The master agent's `@Init` runs the constitution-layer soul check before this method
     * returns, so a missing soul file is fatal at boot.
     */
    @Init()
    public async init() {
        const active = this.config.agent;
        this.agentPool.active = active;
        const agentConfig = this.config.agents[active];
        if (!agentConfig) {
            throw Object.assign(Error('Default agent profile is missing'), {
                detail: { active, configuredAgents: Object.keys(this.config.agents) },
            });
        }
        agentConfig.model = agentConfig.model || this.config.model.model || this.config.model.default;
        agentConfig.provider = agentConfig.provider || this.config.model.provider;
        agentConfig.contextLength = agentConfig.contextLength || this.config.model.contextLength;
        agentConfig.maxTokens = agentConfig.maxTokens || this.config.model.maxTokens;
        // Agent owns its private Memory through IOC injection; Synapse only selects and drives the active person.
        this.agentPool.agents[active] = await useContainer().getAsync(Agent, agentConfig, this);
        this.socket.synapse = this;
        this.on(SynapseSignalType.Input, (signal) => this.input(String(signal.data)));
        this.on(SynapseSignalType.Reply, (signal) => this.output(signal.data));
        this.on(SynapseSignalType.Event, (signal) => this.socket.write({ action: 'data', data: signal.data }));
        this.on(SynapseSignalType.Ask, (signal) => this.socket.write({ action: 'ask', data: signal.data }));
        this.on(SynapseSignalType.Confirm, (signal) => this.socket.write({ action: 'confirm', data: signal.data }));
        return true;
    }

    public async input(data: any) {
        this.log.info('input', data);
        this.agent.next(data);
    }

    public async output(data: unknown) {
        this.socket.write(data === null
            ? { action: 'streamEnd', data: true }
            : { action: 'agent', data: String(data) });
    }
}

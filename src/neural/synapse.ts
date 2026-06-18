import { Agent } from '@/agent';
import type { ConfigService } from '@/configuration';
import { Config, Init, Inject, Logger, Module, useContainer, type FLogger } from '@/core';
import EventEmitter from 'events';
import { FSocket } from './ipc';

export interface AgentPool {
    active: string;
    agents: { [name: string]: Agent };
}

@Module()
export class Synapse extends EventEmitter {
    @Config()
    public readonly config!: ConfigService;

    @Logger(Synapse.name)
    public readonly log!: FLogger;

    @Inject(function (this: Synapse) {
        return this;
    })
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
        // this.log.info('listening', { endpoint: this.config.path.socket });
        this.agent.subscribe(this.output.bind(this));
        this.on('data', this.agent.next.bind(this.agent));
        return true;
    }

    public async output(data: string) {
        this.log.info('output', data);
    }
}

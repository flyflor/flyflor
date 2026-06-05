import { Agent } from '@/agent';
import { Config, Init, Inject, Logger, Singleton, useContainer, type FLogger } from '@/core';
import { ConfigComponent } from '@/config';
import { map, Observable, Subscriber } from 'rxjs';
import type { SocketPacket } from './ipc/ipc.socket';

export interface AgentPool {
    active: string;
    agents: { [name: string]: Agent };
}

@Singleton()
export class Synapse<T extends SocketPacket = SocketPacket> extends Observable<T> {
    @Config()
    public readonly config!: ConfigComponent;

    @Logger('Neural')
    public readonly log!: FLogger;

    public subsciber!: Subscriber<T>;

    public agentPool: AgentPool;

    public get agent() {
        return this.agentPool.agents[this.agentPool.active]!;
    }

    constructor() {
        super((subsciber) => {
            this.subsciber = subsciber;
        });
        this.subscribe({
            next: this.next.bind(this),
            error: this.error.bind(this),
            complete: this.complete.bind(this),
        });
        this.agentPool = { active: '', agents: {} };
    }

    /**
     * Spawns the master agent from the configured `activeAgent` profile and logs the runtime as
     * ready. The master agent's `@Init` runs the constitution-layer soul check before this method
     * returns, so a missing soul file is fatal at boot.
     */
    @Init()
    public async init(): Promise<void> {
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
        this.agentPool.agents[active] = await useContainer().getAsync(Agent, agentConfig);
    }

    public next(data: SocketPacket) {
        // this.log.debug(data);
        this.agent.pipe(
            map((d) => {
                this.log.debug('d', d);
                this.log.debug('data', data);
                return data;
            }),
        );
    }

    public error(err: Error) {}

    public complete() {}
}

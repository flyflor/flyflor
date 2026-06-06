import { Agent } from '@/agent';
import { Config, Init, Logger, Singleton, useContainer, type FLogger } from '@/core';
import { ConfigComponent } from '@/config';
import { Subject, Subscriber } from 'rxjs';
import { SocketEvent, type SocketPacket } from './packet';

export interface AgentPool {
    active: string;
    agents: { [name: string]: Agent };
}

@Singleton()
export class Synapse<T extends SocketPacket = SocketPacket> extends Subject<T> {
    @Config()
    public readonly config!: ConfigComponent;

    @Logger('Neural')
    public readonly log!: FLogger;

    public subscriber!: Subscriber<T>;

    public agentPool: AgentPool;

    public get agent() {
        return this.agentPool.agents[this.agentPool.active]!;
    }

    constructor() {
        super();
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

    public override async next(packet: SocketPacket) {
        this.log.debug(packet);
        if (packet.action !== SocketEvent.User) {
            throw Object.assign(Error('Unsupported IPC action'), { detail: { action: packet.action } });
        }
        if (typeof packet.data !== 'string' || packet.data.trim().length === 0) {
            throw Object.assign(Error('User message must be a non-empty string'), { detail: { data: packet.data } });
        }
        // const response = await this.agent.chat(packet.data.trim());
        const response: any = {};
        return await this.agent.next({ action: SocketEvent.Agent, data: response });
    }
}

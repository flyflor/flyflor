import { Agent } from '@/agent';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Module, Scope, useContainer } from '@/core';
import { FSocket } from './ipc';
import { SynapseSignalType, type SynapseSignal } from './types';

export interface AgentPool {
    [name: string]: Agent;
}

/**
 * Synapse is the neural bus. It owns:
 * - the long-lived active agent that owns user-visible output
 * - a pool of cached agent instances keyed by profile name
 * - a transient worker factory used by the `Task` multi-agent coordinator
 *
 * Active and cached instances share singleton state (memory, context, and
 * lifecycle) for the profile. Worker instances are built fresh on every call:
 * they share the profile's static persona (SOUL/USER/EXTENSION/AGENTS) but
 * run a private context so a worker never leaks state back into the active
 * agent and never emits to the socket.
 */
@Module()
export class Synapse extends FCortex<SynapseSignal> {
    @Config()
    public readonly config!: ConfigService;

    @Scope()
    public socket!: FSocket;

    public agentPool: AgentPool;
    public active: string;

    public get agent() {
        return this.agentPool[this.active]!;
    }

    constructor() {
        super();
        this.agentPool = {};
        this.active = '';
    }

    @Init()
    public async init() {
        const active = this.config.agent;
        this.active = active;
        await this.spawnAgent(active);
        this.socket.synapse = this;
        this.on(SynapseSignalType.Input, (signal) => this.input(String(signal.data)));
        this.on(SynapseSignalType.Reply, (signal) => this.output(signal.data));
        this.on(SynapseSignalType.Event, (signal) => this.socket.write({ action: 'data', data: signal.data }));
        this.on(SynapseSignalType.Ask, (signal) => this.socket.write({ action: 'ask', data: signal.data }));
        this.on(SynapseSignalType.Confirm, (signal) => this.socket.write({ action: 'confirm', data: signal.data }));
        this.on(SynapseSignalType.Pause, (signal) => this.socket.write({ action: 'pause', data: signal.data }));
        this.on(SynapseSignalType.Resume, (signal) => this.socket.write({ action: 'resume', data: signal.data }));
        return true;
    }

    public async spawnAgent(name: string): Promise<Agent> {
        const existing = this.agentPool[name];
        if (existing) return existing;
        const agentConfig = this.config.agents[name];
        if (!agentConfig) {
            throw Object.assign(Error('Default agent profile is missing'), {
                detail: { active: name, configuredAgents: Object.keys(this.config.agents) },
            });
        }
        agentConfig.model = agentConfig.model || this.config.model.model || this.config.model.default;
        agentConfig.provider = agentConfig.provider || this.config.model.provider;
        agentConfig.contextLength = agentConfig.contextLength || this.config.model.contextLength;
        agentConfig.maxTokens = agentConfig.maxTokens || this.config.model.maxTokens;
        const agent = await useContainer().getAsync(Agent, agentConfig, this);
        this.agentPool[name] = agent;
        return agent;
    }

    /**
     * EN: Spawns a transient worker agent for the `Task` coordinator. The
     * worker shares the named profile's persona but is a fresh instance
     * with private context, so its investigation never leaks into the
     * active agent's memory and never emits to the socket.
     * ZH: 为 `Task` 协调器 spawn 一个临时 worker。worker 共享该 profile
     * 的人格,但有独立的实例和私有 context,worker 的 investigation 不会
     * 泄漏到主 agent 的记忆,也不会向 socket 广播。
     */
    public async spawnWorker(name: string): Promise<Agent> {
        const agentConfig = this.config.agents[name];
        if (!agentConfig) {
            throw Object.assign(Error('Worker agent profile is missing'), {
                detail: { requested: name, configuredAgents: Object.keys(this.config.agents) },
            });
        }
        agentConfig.model = agentConfig.model || this.config.model.model || this.config.model.default;
        agentConfig.provider = agentConfig.provider || this.config.model.provider;
        agentConfig.contextLength = agentConfig.contextLength || this.config.model.contextLength;
        agentConfig.maxTokens = agentConfig.maxTokens || this.config.model.maxTokens;
        return await useContainer().getAsync(Agent, agentConfig, this);
    }

    public async input(data: any) {
        this.log.info('input', data);
        try {
            await this.agent.next(data);
        } catch (error) {
            this.log.error('synapse.input', error);
            this.emit(SynapseSignalType.Reply, '处理这条消息时出错，请重试。');
            this.emit(SynapseSignalType.Reply, null);
        }
    }

    public async output(data: unknown) {
        this.socket.write(data === null
            ? { action: 'streamEnd', data: true }
            : { action: 'agent', data: String(data) });
    }
}
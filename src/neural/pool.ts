import { Agent, type AgentBus } from '@/agent';
import type { ConfigService, FAgentProfileConfiguration } from '@/config';
import { Config, FComponent, Init, Provide, useContainer } from '@/core';

/**
 * ZH: 持有一个 Synapse 生命周期中的活跃身份与全部持久 Agent。
 * EN: Owns the active identity and every persistent Agent created for one Synapse lifecycle.
 */
@Provide()
export class AgentPool extends FComponent {
    @Config()
    public config!: ConfigService;

    private readonly agents: Map<string, Agent>;
    private active: string;
    private bus?: AgentBus;

    /** ZH: 创建一个尚未绑定皮层总线的持久人物池。 EN: Creates an unbound persistent-person pool. */
    public constructor() {
        super();
        this.agents = new Map();
        this.active = '';
        this.bus = undefined;
    }

    /** ZH: 在人物池暴露给 Synapse 前验证已配置身份。 EN: Validates configured identities before the pool is exposed to Synapse. */
    @Init()
    public init(): void {
        this.active = this.config.agent;
        for (const name of Object.keys(this.config.agents)) this.profile(name);
        if (!this.config.agents[this.active]) throw Error(`Active Agent is not configured: ${this.active}`);
    }

    /** ZH: 绑定唯一皮层总线，并一次性创建全部已配置人物。 EN: Binds the sole cortical bus and creates every configured person once. */
    public async bind(bus: AgentBus): Promise<void> {
        if (this.bus && this.bus !== bus) throw Error('Agent pool is already bound to another cortical bus');
        this.bus = bus;
        for (const name of Object.keys(this.config.agents)) await this.spawn(name);
    }

    /** ZH: 返回当前活跃的持久人物。 EN: Returns the currently active persistent person. */
    public get agent(): Agent {
        const agent = this.agents.get(this.active);
        if (!agent) throw Error(`Active Agent is unavailable: ${this.active}`);
        return agent;
    }

    /** ZH: 返回已有的人物，或一次性创建其隔离 IOC scope。 EN: Returns an existing person or creates its isolated IOC scope once. */
    public async spawn(name: string): Promise<Agent> {
        const existing = this.agents.get(name);
        if (existing) return existing;
        if (!this.bus) throw Error('Agent pool is not bound to a cortical bus');
        const agent = await useContainer().getAsync(Agent, this.profile(name), this.bus);
        this.agents.set(name, agent);
        return agent;
    }

    /** ZH: 验证并复制一个已配置 profile，且不修改共享配置。 EN: Validates and copies one configured profile without mutating shared configuration. */
    private profile(name: string): FAgentProfileConfiguration {
        const profile = this.config.agents[name];
        if (!profile) throw Error(`Agent profile is missing: ${name}`);
        if (profile.name !== name) throw Error(`Agent profile name does not match: ${name}`);
        if (!profile.model || !profile.provider) throw Error(`Agent model configuration is incomplete: ${name}`);
        if (!Number.isFinite(profile.contextLength) || profile.contextLength <= 0) throw Error(`Agent context length is invalid: ${name}`);
        if (!Number.isFinite(profile.maxTokens) || profile.maxTokens <= 0) throw Error(`Agent max tokens is invalid: ${name}`);
        if (!profile.promptPackage || !profile.promptSections || profile.promptSections.length === 0) {
            throw Error(`Agent prompt configuration is incomplete: ${name}`);
        }
        return { ...profile, promptSections: [...profile.promptSections] };
    }
}

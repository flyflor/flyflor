import type { ConfigService } from '@/configuration';
import { Config, FModule, Init, Inject, Module, useContainer } from '@/core';
import { FSocket } from '@/neural/sensorimotor';
import { Agent } from './agent';
import { AgentProfile, type PopulationRouter } from './types';

/**
 * EN: AgentManager is the population root. It owns the configured agent set,
 * the speaker→agent bindings, and the routing boundary the shared socket
 * transport talks to. With a single configured agent every speaker falls back
 * to `population.main`, which reproduces the previous single-agent behavior.
 * ZH: AgentManager 是种群根。它持有配置出来的 agent 集合、说话人→agent 绑定,
 * 以及共享 socket 传输对话的路由边界。只配置一个 agent 时,所有说话人都回落到
 * `population.main`,行为与之前的单 agent 完全一致。
 */
@Module()
export class AgentManager extends FModule implements PopulationRouter {
    /** EN: Shared unix socket transport all agents motor-output through. ZH: 全部 agent 共享的 unix socket 运动输出传输。 */
    @Inject()
    public socket!: FSocket;

    /** EN: Runtime configuration injected from the IOC container. ZH: 由 IOC 容器注入的运行时配置。 */
    @Config()
    public config!: ConfigService;

    /** EN: Live agents keyed by profile id. ZH: 按档案 id 索引的存活 agent。 */
    public agents: Map<string, Agent>;
    /** EN: Speaker→agent bindings; unbound speakers fall back to the main agent. ZH: 说话人→agent 绑定;未绑定的说话人回落到主 agent。 */
    public bindings: Map<string, string>;

    constructor() {
        super();
        this.agents = new Map();
        this.bindings = new Map();
    }

    /**
     * EN: Attaches this router to the shared transport, then builds every
     * configured agent. Duplicate ids are skipped; specifications beyond the
     * configured capacity are truncated with a warning.
     * ZH: 先把本路由器挂到共享传输上,再构建全部配置的 agent。重复 id 跳过;
     * 超出配置容量的规格截断并告警。
     */
    @Init()
    public async init() {
        this.socket.attachRouter(this);
        const population = this.config.population;
        const capacity = Math.max(1, Math.floor(population.capacity));
        const seen = new Set<string>();
        for (const spec of population.agents) {
            if (seen.has(spec.id)) continue;
            seen.add(spec.id);
            if (this.agents.size >= capacity) {
                this.log.warn('population.capacity', { id: spec.id, capacity });
                break;
            }
            const profile = useContainer().create(AgentProfile, spec.id, spec.personaPackage);
            const agent = await this.spawnAgent(profile);
            this.agents.set(profile.id, agent);
        }
        return true;
    }

    /**
     * EN: Builds one agent around a profile through the IOC container. Kept as
     * a separate method so tests can override the construction.
     * ZH: 通过 IOC 容器围绕一份档案构建一个 agent。单独成方法,便于测试覆盖构造。
     */
    public async spawnAgent(profile: AgentProfile): Promise<Agent> {
        return await useContainer().getAsync(Agent, profile);
    }

    /**
     * EN: Routes one inbound user message to the speaker's bound agent.
     * ZH: 把一条入站用户消息路由到说话人绑定的 agent。
     */
    public perceive(input: { speakerId: string; text: string }): unknown {
        return this.agentFor(input.speakerId)?.perceive(input);
    }

    /**
     * EN: Routes one interaction answer to the speaker's bound agent.
     * ZH: 把一条交互答复路由到说话人绑定的 agent。
     */
    public answer(turnId: string, id: string, response: unknown, speakerId?: string): void {
        this.agentFor(speakerId)?.answer(turnId, id, response, speakerId);
    }

    /**
     * EN: Drops the speaker's binding and forwards the forget to its agent.
     * ZH: 丢弃说话人的绑定,并把遗忘转发给它绑定的 agent。
     */
    public forget(speakerId: string): void {
        const agent = this.agentFor(speakerId);
        this.bindings.delete(speakerId);
        agent?.forget(speakerId);
    }

    /**
     * EN: Rebinds one speaker to another agent; false when the agent id is unknown.
     * ZH: 把说话人换绑到另一个 agent;agent id 未知时返回 false。
     */
    public route(speakerId: string, agentId: string): boolean {
        if (!this.agents.has(agentId)) return false;
        this.bindings.set(speakerId, agentId);
        return true;
    }

    private agentFor(speakerId?: string): Agent | undefined {
        const agentId = (speakerId === undefined ? undefined : this.bindings.get(speakerId)) ?? this.config.population.main;
        const agent = this.agents.get(agentId);
        if (!agent) this.log.warn('population.agent_missing', { speakerId, agentId });
        return agent;
    }
}

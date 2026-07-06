import { Agent, AgentChatRole } from '@/agent';
import { Context } from '@/agent/context';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, Prompt, PromptService, Scope, useContainer } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { CallosumSignal } from '@/agent/brain/callosum';
import { FSocket } from './ipc';
import { SynapseSignalType, type CoordinatePlan, type SynapseSignal } from './types';

export interface AgentPool {
    [name: string]: Agent;
}

/**
 * EN: Synapse is the neural cortex. It routes signals, owns the active agent,
 * and dispatches the agent pool when Callosum decides multi-agent coordination
 * is needed to understand the user intent.
 * ZH: Synapse 是神经皮层。它路由信号、持有 active agent，并在 Callosum 判断需要
 * 多 agent 协同理解用户意图时派发 agent pool。
 */
@Module()
export class Synapse extends FCortex<SynapseSignal> {
    @Config()
    public readonly config!: ConfigService;

    @Scope()
    public socket!: FSocket;

    @Inject()
    public context!: Context;

    @Inject()
    public intelligence!: Intelligence;

    @Prompt('prompts/synapse/plan')
    public planPrompt!: PromptService;

    @Prompt('prompts/synapse/synthesis')
    public synthesisPrompt!: PromptService;

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
        this.on(SynapseSignalType.Coordinate, (signal) => this.coordinate(signal.data as CallosumSignal));
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
     * EN: Spawns a fresh worker agent for one coordination slice. The worker is
     * not cached in the agent pool: it is an independent instance with its own
     * private Memory and does not emit to the socket.
     * ZH: 为一个协调切片 spawn 一个全新的 worker agent。worker 不缓存在 agent pool
     * 中：它是独立实例，拥有私有 Memory，不向 socket 广播。
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

    /**
     * EN: Cortex dispatch. Callosum decided the user intent needs multi-agent
     * joint understanding. This single path plans, dispatches the agent pool,
     * and synthesizes the final reply through Synapse signals.
     * ZH: 皮层派发。Callosum 已判断用户意图需要多 agent 协同理解。本条路径一次性
     * 完成计划、派发 agent pool、合成最终回复，并通过 Synapse 信号输出。
     */
    private async coordinate(signal: CallosumSignal): Promise<void> {
        // EN: Ask the cortex plan prompt how to slice the understanding work.
        // ZH: 询问皮层计划提示词如何切分理解工作。
        const brief = this.context.brief('cortex');
        const plan = parse<CoordinatePlan>(await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.planPrompt.section('plan') },
            { role: AgentChatRole.User, content: `${JSON.stringify(brief)}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]));

        if (plan.slices.length === 0) {
            // EN: No real decomposition; fall back to the active agent's single-agent path.
            // ZH: 没有实际分解；退回 active agent 的单 agent 路径。
            await this.agent.next(signal.chunk);
            return;
        }

        // EN: Dispatch one independent worker per slice. Each worker gets its own
        // private Memory seeded from the Context brief. If any worker pauses for
        // ask/confirm, stop and let Synapse resume later.
        // ZH: 每个切片派发一个独立 worker。每个 worker 都从 Context 简报获得私有记忆
        // 种子。如果某个 worker 因 ask/confirm 暂停，则停止，稍后再由 Synapse 恢复。
        const outcomes: Array<{ profile: string; slice: string; brief: string; result: string; evidence: string[] }> = [];
        for (const slice of plan.slices) {
            const agent = await this.spawnWorker(slice.profile);
            const outcome = await agent.understand(this.context.brief(slice.profile));
            if (!outcome) return;
            outcomes.push({ profile: slice.profile, slice: slice.slice, brief: slice.brief, result: outcome.answer, evidence: outcome.evidence });
        }

        // EN: Synthesize worker understandings into one coherent reply.
        // ZH: 把各 worker 的理解合成一条连贯回复。
        const answer = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.synthesisPrompt.section('synthesis') },
            { role: AgentChatRole.User, content: JSON.stringify({ outcomes, hint: plan.synthesisHint }) },
        ]);

        this.emit(SynapseSignalType.Reply, answer);
        this.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant: answer, evidence: outcomes.flatMap((outcome) => outcome.evidence) });
    }
}
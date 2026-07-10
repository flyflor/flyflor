import { Agent, AgentChatRole } from '@/agent';
import { Context, type AgentBrief } from '@/agent/context';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, Prompt, PromptService, Scope, useContainer } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { CallosumSignal } from '@/agent/brain/callosum';
import { FSocket } from './ipc';
import { SynapseSignalType, type CoordinatePlan, type InteractionRequest, type InteractionResponse, type SynapseSignal } from './types';

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

    @Prompt('prompts/synapse')
    public prompt!: PromptService;

    public agentPool: AgentPool;
    public active: string;
    private interaction?: {
        request: InteractionRequest;
        resolve: (response: InteractionResponse) => void;
    };

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

    public async interact(request: InteractionRequest): Promise<InteractionResponse> {
        if (this.interaction) throw Error('An interaction is already pending');
        this.context.pause(request.turnId, { id: request.id, kind: request.kind, prompt: JSON.stringify(request.data) });
        this.emit(request.kind === 'ask' ? SynapseSignalType.Ask : SynapseSignalType.Confirm, {
            turnId: request.turnId,
            id: request.id,
            ...request.data as object,
        });
        this.emit(SynapseSignalType.Pause, request);
        return await new Promise<InteractionResponse>((resolve) => {
            this.interaction = { request, resolve };
        });
    }

    public answer(turnId: string, id: string, response: InteractionResponse): void {
        const interaction = this.interaction;
        if (!interaction || interaction.request.turnId !== turnId || interaction.request.id !== id) {
            throw Error('Interaction response does not match pending request');
        }
        if (interaction.request.kind !== response.kind) throw Error('Interaction response kind does not match request');
        this.context.resume(turnId, id);
        this.interaction = undefined;
        interaction.resolve(response);
        this.emit(SynapseSignalType.Resume, { turnId, id });
    }

    /**
     * EN: Cortex dispatch. Callosum decided the user intent needs multi-agent
     * joint understanding. This single path plans, dispatches the agent pool,
     * and synthesizes the final reply through Synapse signals.
     * ZH: 皮层派发。Callosum 已判断用户意图需要多 agent 协同理解。本条路径一次性
     * 完成计划、派发 agent pool、合成最终回复，并通过 Synapse 信号输出。
     */
    public async coordinate(signal: CallosumSignal, turnId: string): Promise<void> {
        // EN: Ask the cortex plan prompt how to slice the understanding work.
        // ZH: 询问皮层计划提示词如何切分理解工作。
        const brief = this.context.brief(turnId);
        const plan = parse<CoordinatePlan>(await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('plan') },
            { role: AgentChatRole.User, content: `${JSON.stringify(brief)}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]));

        // EN: Dispatch one independent worker per slice. Each worker gets its own
        // private Memory seeded from the Context brief. If any worker pauses for
        // ask/confirm, stop and let Synapse resume later.
        // ZH: 每个切片派发一个独立 worker。每个 worker 都从 Context 简报获得私有记忆
        // 种子。如果某个 worker 因 ask/confirm 暂停，则停止，稍后再由 Synapse 恢复。
        const outcomes: Array<{ profile: string; persona: string; slice: string; brief: string; result: string; evidence: string[] }> = [];
        const slices = plan.slices.length === 0
            ? [{ profile: this.active, persona: '', brief: this.context.brief(turnId).goal, slice: String(signal.chunk) }]
            : plan.slices;
        for (const slice of slices) {
            const agent = await this.spawnWorker(slice.profile);
            const outcome = await agent.understand(this.workerBrief(slice, turnId));
            if (!outcome) return;
            outcomes.push({ profile: slice.profile, persona: slice.persona, slice: slice.slice, brief: slice.brief, result: outcome.answer, evidence: outcome.evidence });
        }

        const reviewer = await this.spawnWorker(plan.review.profile);
        const review = await reviewer.understand(this.reviewBrief(plan, outcomes, turnId));
        if (!review) return;

        // EN: Synthesize worker understandings into one coherent reply.
        // ZH: 把各 worker 的理解合成一条连贯回复。
        const answer = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section('synthesis') },
            { role: AgentChatRole.User, content: JSON.stringify({ outcomes, review: { profile: plan.review.profile, persona: plan.review.persona, result: review.answer, evidence: review.evidence }, hint: plan.synthesisHint }) },
        ]);

        await this.context.settle(turnId, { assistant: answer, evidence: [...outcomes.flatMap((outcome) => outcome.evidence), ...review.evidence] });
        this.emit(SynapseSignalType.Reply, answer);
        this.emit(SynapseSignalType.Reply, null);
    }

    private workerBrief(slice: { profile: string; persona: string; brief: string; slice: string }, turnId: string): AgentBrief {
        const brief = this.context.brief(turnId);
        return {
            ...brief,
            goal: slice.brief,
            persona: slice.persona,
            constraints: [...brief.constraints, slice.slice],
        };
    }

    private reviewBrief(
        plan: CoordinatePlan,
        outcomes: Array<{ profile: string; persona: string; slice: string; brief: string; result: string; evidence: string[] }>,
        turnId: string,
    ): AgentBrief {
        const brief = this.context.brief(turnId);
        return {
            ...brief,
            goal: JSON.stringify({ review: plan.review.brief, focus: plan.review.focus, intent: plan.intent, outcomes }),
            persona: plan.review.persona,
        };
    }
}

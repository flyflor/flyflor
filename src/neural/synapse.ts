import {
    Agent,
    Context,
    type AgentBus,
    type AgentTask,
    type AskResponse,
    type AskSignal,
    type CompleteSignal,
    type ConfirmResponse,
    type ConfirmSignal,
    type NeuralResponse,
    type NeuralSignal,
    type ReplySignal,
    type TaskSignal,
} from '@/agent';
import type { ConfigService, FAgentProfileConfiguration } from '@/config';
import { Config, FCortex, Init, Inject, Module, Observable, useContainer } from '@/core';
import { FSocket } from '@/transport';
import type { ExpressionSignal, InteractionResponse, InteractionSignal } from './types';

/**
 * EN: The life form's persistent cortex, owning signal routes and persistent people.
 * ZH: 智能生命体的持久皮层，持有信号路由与持续存在的人物。
 */
@Module()
export class Synapse extends FCortex implements AgentBus {
    @Config()
    public config!: ConfigService;

    @Inject()
    public socket!: FSocket;

    @Inject()
    public context!: Context;

    @Inject(() => 'sensory')
    public sensory!: Observable<string>;

    @Inject(() => 'interaction')
    public interaction!: Observable<InteractionSignal>;

    @Inject(() => 'delegation')
    public delegation!: Observable<TaskSignal>;

    @Inject(() => 'expression')
    public expression!: Observable<ExpressionSignal>;

    private readonly agents = new Map<string, Agent>();
    private active = '';
    private pending?: {
        signal: InteractionSignal;
        resolve: (response: InteractionResponse) => void;
    };

    /**
     * EN: Wires independent cortical circuits and creates every configured person once.
     * ZH: 连接相互独立的皮层回路，并一次性创建全部已配置人物。
     */
    @Init()
    public async init(): Promise<void> {
        this.active = this.config.agent;
        for (const name of Object.keys(this.config.agents)) await this.spawnAgent(name);
        if (!this.agents.has(this.active)) throw Error(`Active Agent is not configured: ${this.active}`);

        this.sensory.pipe((input) => this.agent.receive({ type: 'input', input }));
        this.interaction.switch<InteractionSignal['type'], InteractionResponse>((signal) => signal.type, {
            ask: (signal) => this.wait(signal as AskSignal),
            confirm: (signal) => this.wait(signal as ConfirmSignal),
        });
        this.delegation.pipe((signal) => this.delegate(signal));
        this.expression.switch<ExpressionSignal['type'], ExpressionSignal>((signal) => signal.type, {
            reply: (signal) => this.reply(signal as ReplySignal),
            complete: (signal) => this.complete(signal as CompleteSignal),
        });
        this.socket.bind({
            input: async (text) => { await this.sensory.next(text); },
            answer: (turnId, id, response) => this.answer(turnId, id, response),
        });
    }

    /**
     * EN: Returns the currently active persistent person.
     * ZH: 返回当前活跃的持久人物。
     */
    public get agent(): Agent {
        const agent = this.agents.get(this.active);
        if (!agent) throw Error(`Active Agent is unavailable: ${this.active}`);
        return agent;
    }

    /**
     * EN: Routes one Agent firing to exactly one independent cortical circuit.
     * ZH: 将一次 Agent 放电路由到唯一的独立皮层回路。
     */
    public async fire<TSignal extends NeuralSignal>(signal: TSignal): Promise<NeuralResponse<TSignal>> {
        if (signal.type === 'ask' || signal.type === 'confirm') {
            return await this.interaction.next(signal) as unknown as NeuralResponse<TSignal>;
        }
        if (signal.type === 'task') {
            return await this.delegation.next(signal) as unknown as NeuralResponse<TSignal>;
        }
        await this.expression.next(signal);
        return undefined as NeuralResponse<TSignal>;
    }

    /**
     * EN: Returns an existing person or creates its isolated IOC scope once.
     * ZH: 返回已有的人物，或一次性创建其隔离 IOC scope。
     */
    public async spawnAgent(name: string): Promise<Agent> {
        const existing = this.agents.get(name);
        if (existing) return existing;
        const profile = this.profile(name);
        const agent = await useContainer().getAsync(Agent, profile, this);
        this.agents.set(name, agent);
        return agent;
    }

    /**
     * EN: Resolves an exact pending user answer and resumes its Context Turn.
     * ZH: 解析精确匹配的用户回答，并恢复对应 Context Turn。
     */
    public answer(turnId: string, id: string, value: unknown): void {
        const pending = this.pending;
        if (!pending || pending.signal.turnId !== turnId || pending.signal.id !== id) {
            throw Error('Interaction response does not match the pending signal');
        }
        const response = this.response(pending.signal, value);
        this.socket.write({ action: 'resume', data: { turnId, id } });
        this.context.resume(turnId, id);
        this.pending = undefined;
        pending.resolve(response);
    }

    /**
     * EN: Waits for one exact Ask or Confirm answer on the serial interaction circuit.
     * ZH: 在串行交互回路上等待一个精确 Ask 或 Confirm 回答。
     */
    private async wait(signal: InteractionSignal): Promise<InteractionResponse> {
        if (this.pending) throw Error('An interaction is already pending');
        this.context.pause(signal.turnId, {
            id: signal.id,
            kind: signal.type,
            prompt: JSON.stringify(signal.type === 'ask' ? signal.questions : signal.call),
        });
        this.socket.write({ action: signal.type, data: signal });
        this.socket.write({ action: 'pause', data: { turnId: signal.turnId, id: signal.id, kind: signal.type } });
        return await new Promise<InteractionResponse>((resolve) => {
            this.pending = { signal, resolve };
        });
    }

    /**
     * EN: Dispatches validated child goals to persistent Agents and awaits all Completes.
     * ZH: 将已验证子目标派发给持久 Agents，并等待全部 Complete。
     */
    private async delegate(signal: TaskSignal): Promise<CompleteSignal[]> {
        return await Promise.all(signal.tasks.map(async (item, index) => {
            if (item.agent === signal.agent) throw Error(`Agent cannot delegate to itself: ${item.agent}`);
            const agent = await this.spawnAgent(item.agent);
            const task: AgentTask = {
                id: `${signal.id}:${index + 1}`,
                turnId: signal.turnId,
                agent: item.agent,
                goal: item.goal,
                context: this.context.brief(signal.turnId),
            };
            return await agent.receive({ type: 'task', task });
        }));
    }

    /**
     * EN: Emits one ordered user-visible reply chunk.
     * ZH: 输出一个有序、用户可见的回复片段。
     */
    private reply(signal: ReplySignal): ReplySignal {
        if (signal.chunk.length === 0) throw Error('Reply chunk is empty');
        this.socket.write({ action: 'agent', data: signal.chunk });
        return signal;
    }

    /**
     * EN: Emits the pure terminal summary before ending the response stream.
     * ZH: 在结束响应流前输出纯净终态摘要。
     */
    private complete(signal: CompleteSignal): CompleteSignal {
        this.socket.write({ action: 'complete', data: signal });
        this.socket.write({ action: 'streamEnd', data: true });
        return signal;
    }

    /**
     * EN: Validates one configured Agent profile without mutating shared configuration.
     * ZH: 验证一个已配置 Agent profile，且不修改共享配置。
     */
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

    /**
     * EN: Reads one response according to its exact pending interaction kind.
     * ZH: 按待处理交互的精确类型读取一次响应。
     */
    private response(signal: InteractionSignal, value: unknown): InteractionResponse {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Interaction response must be an object');
        const response = value as Record<string, unknown>;
        if (signal.type === 'confirm') {
            if (response.kind !== 'confirm' || typeof response.approved !== 'boolean') throw Error('Confirm response is invalid');
            return { kind: 'confirm', approved: response.approved };
        }
        if (response.kind !== 'ask' || !Array.isArray(response.answers)) throw Error('Ask response is invalid');
        const answers = response.answers.map((answer, index) => {
            if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw Error(`Ask answer is invalid: ${index}`);
            const item = answer as Record<string, unknown>;
            if (typeof item.question !== 'string' || typeof item.answer !== 'string') throw Error(`Ask answer is invalid: ${index}`);
            return { question: item.question, answer: item.answer };
        });
        return { kind: 'ask', answers };
    }
}

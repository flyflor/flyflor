import { Agent, AgentChatRole } from '@/agent';
import type { AgentInput } from '@/agent/types';
import { Context, type AgentBrief } from '@/agent/context';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, Prompt, PromptService, Scope, useContainer } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import { Awareness } from '@/neural/awareness';
import { DispositionRelation, type AttentionInstruction, type Stimulus } from '@/neural/awareness/types';
import { FSocket } from './ipc';
import {
    SynapseSignalType,
    TurnPreempted,
    type CoordinateOutcome,
    type CoordinatePlan,
    type InteractionRequest,
    type InteractionResponse,
    type ReplyChunk,
    type SynapseSignal,
} from './types';

/**
 * EN: Registry of cached agents, keyed by agent profile name.
 * ZH: 按 agent 配置名索引的已缓存 agent 注册表。
 */
export interface AgentPool {
    /** EN: Cached agent instance for this profile name. ZH: 该配置名对应的已缓存 agent 实例。 */
    [name: string]: Agent;
}

/**
 * EN: Synapse is the neural cortex. It routes signals, owns the active agent,
 * and dispatches the agent pool when the semantic Turn intent requires
 * multi-agent coordination.
 * ZH: Synapse 是神经皮层。它路由信号、持有 active agent，并在语义 Turn intent
 * 需要多 agent 协同理解时派发 agent pool。
 */
@Module()
export class Synapse extends FCortex<SynapseSignal> {
    /** EN: Runtime configuration injected from the IOC container. ZH: 由 IOC 容器注入的运行时配置。 */
    @Config()
    public readonly config!: ConfigService;

    /** EN: Unix socket surface used for motor output. ZH: 用于运动输出的 Unix socket 表面。 */
    @Scope()
    public socket!: FSocket;

    /** EN: Semantic workspace that owns Turn lifecycle. ZH: 持有 Turn 生命周期的语义工作区。 */
    @Inject()
    public context!: Context;

    /** EN: Intelligence provider used for plan and synthesis completions. ZH: 用于计划与合成补全的智能提供方。 */
    @Inject()
    public intelligence!: Intelligence;

    /** EN: Attention gate that routes stimuli into this cortex. ZH: 将刺激路由进本皮层的注意门。 */
    @Inject()
    public awareness!: Awareness;

    /** EN: Prompt template for multi-agent coordination planning. ZH: 多 agent 协同计划的提示词模板。 */
    @Prompt('prompts/synapse')
    public planPrompt!: PromptService;

    /** EN: Prompt template for synthesizing the final coordinated reply. ZH: 合成最终协同回复的提示词模板。 */
    @Prompt('prompts/synapse')
    public synthesisPrompt!: PromptService;

    /** EN: Cached agents by profile name; spawned lazily on demand. ZH: 按配置名缓存的 agent；按需惰性 spawn。 */
    public agentPool: AgentPool;
    /** EN: Name of the currently active agent profile. ZH: 当前活跃 agent 配置名。 */
    public active: string;
    /** EN: Pending ask/confirm waiters keyed by Turn id. ZH: 按 Turn id 索引的待答复 ask/confirm 等待者。 */
    private interactions: Map<string, { request: InteractionRequest; resolve: (response: InteractionResponse) => void; reject: (error: Error) => void }>;
    /** EN: Abort handles for in-flight Turns keyed by Turn id. ZH: 按 Turn id 索引的在途 Turn 中止句柄。 */
    private turnControllers: Map<string, AbortController>;
    /** EN: Abort handles keyed by stimulus id, addressable before Context has created a Turn. ZH: 按刺激 id 索引的中止句柄，在 Context 创建 Turn 之前即可寻址。 */
    private stimulusControllers: Map<string, { controller: AbortController; speakerId: string }>;

    /** EN: The agent instance behind the active profile name. ZH: 当前活跃配置名对应的 agent 实例。 */
    public get agent() {
        return this.agentPool[this.active]!;
    }

    constructor() {
        super();
        // EN: Agent cache starts empty and fills on demand. ZH: agent 缓存初始为空，按需填充。
        this.agentPool = {};
        // EN: No active profile until init() reads the config. ZH: init() 读取配置前没有活跃配置。
        this.active = '';
        // EN: Pending ask/confirm waiters keyed by Turn id. ZH: 按 Turn id 索引的待答复 ask/confirm 等待者。
        this.interactions = new Map();
        // EN: Abort handles for in-flight Turns keyed by Turn id. ZH: 按 Turn id 索引的在途 Turn 中止句柄。
        this.turnControllers = new Map();
        // EN: Abort handles keyed by stimulus id, before a Turn exists. ZH: 按刺激 id 索引的中止句柄，早于 Turn 创建。
        this.stimulusControllers = new Map();
    }

    /**
     * EN: Lifecycle init: resolve the configured active agent, spawn it, attend
     * to Awareness, and wire every Synapse signal type to its motor output.
     * ZH: 生命周期初始化：解析配置的活跃 agent 并 spawn，接入 Awareness，
     * 并将每种 Synapse 信号类型接到对应的运动输出。
     */
    @Init()
    public async init() {
        const active = this.config.agent;
        this.active = active;
        await this.spawnAgent(active);
        this.awareness.attend(this);
        this.on(SynapseSignalType.Reply, (signal) => this.output(signal.data));
        this.on(SynapseSignalType.Event, (signal) => this.addressedWrite('data', signal.data));
        this.on(SynapseSignalType.Ask, (signal) => this.addressedWrite('ask', signal.data));
        this.on(SynapseSignalType.Confirm, (signal) => this.addressedWrite('confirm', signal.data));
        this.on(SynapseSignalType.Pause, (signal) => this.addressedWrite('pause', signal.data));
        this.on(SynapseSignalType.Resume, (signal) => this.addressedWrite('resume', signal.data));
        return true;
    }

    /**
     * EN: Returns the cached agent for a profile, spawning and caching it on
     * first use. Missing profiles throw with the configured names as detail.
     * ZH: 返回某配置对应的已缓存 agent，首次使用时 spawn 并缓存。配置缺失时抛出
     * 携带已配置名单的错误。
     */
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

    /**
     * EN: Awareness asks the cortex to pay attention to one stimulus. This is the
     * entry point for the active thought stream. The error boundary is the single
     * place where a failing main turn is reported to the speaker.
     * ZH: Awareness 请求皮层注意一条刺激。这是主动意识流的入口。失败的主 turn 通过
     * 此处统一错误边界报告给说话人。
     */
    public async attend(stimulus: Stimulus, instruction: AttentionInstruction = stimulus.attention ?? { relation: DispositionRelation.New, urgent: false }): Promise<void> {
        await this.runStimulus(stimulus, instruction);
    }

    /**
     * EN: Awareness uses the same foreground boundary for a same-thread revision.
     * ZH: Awareness 对同线程修订复用同一个前台边界。
     */
    public async revise(stimulus: Stimulus, targetTurnId: string): Promise<void> {
        await this.runStimulus(stimulus, {
            relation: DispositionRelation.Same,
            targetTurnId,
            urgent: stimulus.attention?.urgent ?? false,
        });
    }

    private async runStimulus(stimulus: Stimulus, instruction: AttentionInstruction): Promise<void> {
        // Logs are diagnostics, not an episodic store; never persist stimulus text.
        this.log.info('input', {
            speakerId: stimulus.speakerId,
            stimulusId: stimulus.id,
            textLength: stimulus.text.length,
            relation: instruction.relation,
        });
        const controller = new AbortController();
        const input: AgentInput = {
            text: stimulus.text,
            speakerId: stimulus.speakerId,
            stimulusId: stimulus.id,
            relation: instruction.relation,
            targetTurnId: instruction.targetTurnId,
            signal: controller.signal,
        };
        const targetTurnId = instruction.targetTurnId;
        this.stimulusControllers.set(stimulus.id, { controller, speakerId: stimulus.speakerId });
        if (targetTurnId) this.turnControllers.set(targetTurnId, controller);
        try {
            await this.agent.next(input);
            const settledTurn = input.stimulusId ? this.context.turnForStimulus(input.stimulusId) : undefined;
            this.awareness.turnSettled(settledTurn?.id ?? input.targetTurnId ?? '');
        } catch (error) {
            if (error instanceof TurnPreempted) {
                this.awareness.turnInterrupted(error.turnId);
                return;
            }
            const active = this.context.working();
            if (active && (this.awareness.preempted(active.id) || controller.signal.aborted)) {
                try {
                    if (active.status === 'working') await this.context.interrupt(active.id, { assistant: '' });
                } catch {
                    if (this.context.working()?.id === active.id) this.context.suspend(active.id);
                }
                this.awareness.turnInterrupted(active.id);
                return;
            }
            // A disconnect can abort an ingest before Context has created a Turn.
            // There is no speaker-facing error to send in that case.
            if (controller.signal.aborted) return;
            if (active?.stimulusId === stimulus.id && active.status === 'working') {
                try {
                    await this.context.interrupt(active.id, { assistant: '' });
                } catch {
                    if (this.context.working()?.id === active.id) this.context.suspend(active.id);
                }
                this.awareness.turnInterrupted(active.id);
            }
            this.log.error('synapse.input', { name: error instanceof Error ? error.name : 'UnknownError' });
            const { speakerId } = input;
            this.awareness.say(speakerId, '处理这条消息时出错，请重试。');
        } finally {
            if (targetTurnId && this.turnControllers.get(targetTurnId) === controller) this.turnControllers.delete(targetTurnId);
            if (this.stimulusControllers.get(stimulus.id)?.controller === controller) this.stimulusControllers.delete(stimulus.id);
        }
    }

    /**
     * EN: Cancels provider work for a Turn after Awareness has marked it urgent:
     * rejects any pending interaction waiter and aborts the Turn's controller.
     * ZH: 在 Awareness 标记紧急后取消 Turn 的提供方工作：拒绝所有待处理的
     * 交互等待者并中止该 Turn 的控制器。
     */
    public cancel(turnId: string): void {
        const turn = this.context.turns.find((candidate) => candidate.id === turnId);
        const interaction = this.interactions.get(turnId);
        if (interaction) {
            this.interactions.delete(turnId);
            // Put the Turn back into working state before rejecting the waiter;
            // the normal abort boundary can then compact it as suspended.
            try {
                this.context.resume(turnId, interaction.request.id);
            } catch {
                // A concurrent answer/cleanup already owns the lifecycle.
            }
            interaction.reject(Error('Interaction pre-empted'));
        }
        const controller = this.turnControllers.get(turnId)
            ?? (turn?.stimulusId ? this.stimulusControllers.get(turn.stimulusId)?.controller : undefined);
        controller?.abort();
    }

    /**
     * EN: Releases interaction waiters and non-active Context turns for a
     * departed speaker; working turns are cancelled first to avoid racing the
     * interrupt/settle path.
     * ZH: 为已离开的说话人释放交互等待者和非活跃的 Context turn；进行中的 turn
     * 先取消，避免与打断/收尾路径竞争。
     */
    public forgetSpeaker(speakerId: string): void {
        for (const [turnId, interaction] of this.interactions) {
            const turn = this.context.turns.find((candidate) => candidate.id === turnId);
            if (turn?.speakerId !== speakerId) continue;
            this.interactions.delete(turnId);
            interaction.reject(Error('Speaker disconnected'));
        }
        for (const entry of this.stimulusControllers.values()) {
            if (entry.speakerId === speakerId) entry.controller.abort();
        }
        const turns = this.context.turns.filter((turn) => turn.speakerId === speakerId);
        const working = turns.filter((turn) => turn.status === 'working');
        if (working.length > 0) {
            // Keep every turn until the active work has compacted/terminated;
            // deleting it here races Brain's interruption path.
            for (const turn of working) this.cancel(turn.id);
        } else {
            this.context.forgetSpeaker(speakerId);
        }
    }

    /**
     * EN: Motor output for one streamed reply chunk: resolves the speaker from
     * the Turn in Context and hands the chunk to Awareness' one-mouth stream.
     * ZH: 一个流式回复分片的运动输出：从 Context 的 Turn 解析说话人，并把分片交给
     * Awareness 的单口流。
     */
    public async output(data: unknown) {
        const { turnId, chunk, streamId } = data as ReplyChunk;
        const turn = this.context.turns.find((t) => t.id === turnId);
        if (!turn) {
            this.log.warn('synapse.output.turn_not_found', { turnId });
            return;
        }
        this.awareness.speak(turnId, turn.speakerId, chunk, streamId);
    }

    /**
     * EN: Pauses the Turn, emits an ask/confirm plus pause signal to the speaker,
     * and returns a promise that resolves when the speaker answers.
     * ZH: 暂停 Turn，向说话人发出 ask/confirm 及 pause 信号，并返回一个在说话人
     * 答复时兑现的 promise。
     */
    public async interact(request: InteractionRequest): Promise<InteractionResponse> {
        if (this.interactions.has(request.turnId)) throw Error('An interaction is already pending for this turn');
        this.context.pause(request.turnId, { id: request.id, kind: request.kind, prompt: JSON.stringify(request.data) });
        this.emit(request.kind === 'ask' ? SynapseSignalType.Ask : SynapseSignalType.Confirm, {
            turnId: request.turnId,
            id: request.id,
            ...request.data as object,
        });
        this.emit(SynapseSignalType.Pause, request);
        this.awareness.turnPaused(request.turnId);
        return await new Promise<InteractionResponse>((resolve, reject) => {
            this.interactions.set(request.turnId, { request, resolve, reject });
        });
    }

    /**
     * EN: Resolves a pending interaction: validates id/speaker/kind against the
     * stored request, resumes the Turn in Context, and emits a resume signal.
     * ZH: 兑现一个待处理的交互：按存储的请求校验 id/说话人/类型，恢复 Context 中的
     * Turn，并发出 resume 信号。
     */
    public answer(turnId: string, id: string, response: InteractionResponse, speakerId?: string): void {
        const interaction = this.interactions.get(turnId);
        if (!interaction || interaction.request.id !== id) {
            throw Error('Interaction response does not match pending request');
        }
        const turn = this.context.turn(turnId);
        if (speakerId !== undefined && turn.speakerId !== speakerId) {
            throw Error('Interaction response speaker does not match turn');
        }
        if (interaction.request.kind !== response.kind) throw Error('Interaction response kind does not match request');
        this.context.resume(turnId, id);
        this.interactions.delete(turnId);
        interaction.resolve(response);
        this.emit(SynapseSignalType.Resume, { turnId, id });
    }

    /**
     * EN: Motor output: write a packet addressed to the speaker of the given turn.
     * ZH: 运动输出：将包寻址到对应 turn 的说话人。
     */
    public deliver(speakerId: string, packet: { action: string; data: unknown }): void {
        this.socket.write(speakerId, packet);
    }

    /**
     * EN: Cortex dispatch. The Turn intent needs multi-agent joint understanding.
     * Slices run in parallel as unconscious processors (GWT): each gets its own
     * abort handle chained to the turn signal, a failed slice is isolated with a
     * reason instead of dragging the whole turn down, and only a total failure
     * reaches the turn error boundary. Review and synthesis stay serial — the
     * conscious stream — and everything settles into the one originating Turn.
     * ZH: 皮层派发。Turn intent 判断需要多 agent 协同理解。切片作为无意识处理器
     * 并行运行(GWT):每个切片持有级联到 turn 信号的独立中止句柄;失败的切片
     * 带原因隔离记录而不是拖垮整轮,只有全部失败才进入 turn 错误边界。审核与
     * 合成保持串行——即意识流——一切结算回发起它们的同一个 Turn。
     */
    public async coordinate(chunk: string, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        const brief = this.context.brief(turnId);
        const plan = parse<CoordinatePlan>(await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.planPrompt.section('plan') },
            { role: AgentChatRole.User, content: `${JSON.stringify(brief)}\n<latest_user_message>${chunk}</latest_user_message>` },
        ], abortSignal));

        abortSignal?.throwIfAborted();
        const slices = plan.slices.length === 0
            ? [{ profile: this.active, persona: '', brief: this.context.brief(turnId).goal, slice: chunk }]
            : plan.slices;
        const outcomes: CoordinateOutcome[] = await Promise.all(slices.map(async (slice): Promise<CoordinateOutcome> => {
            const controller = new AbortController();
            const chainAbort = () => controller.abort();
            abortSignal?.addEventListener('abort', chainAbort, { once: true });
            try {
                const agent = await this.spawnWorker(slice.profile);
                const outcome = await agent.understand(this.workerBrief(slice, turnId), controller.signal);
                if (!outcome) throw Error(`Worker paused without an interaction boundary: ${slice.profile}`);
                return { profile: slice.profile, persona: slice.persona, slice: slice.slice, brief: slice.brief, result: outcome.answer, evidence: outcome.evidence };
            } catch (error) {
                // The main abort owns the turn: propagate instead of isolating.
                if (abortSignal?.aborted) throw error;
                const reason = error instanceof Error ? error.message : String(error);
                this.log.warn('synapse.coordinate.slice_failed', { profile: slice.profile, reason });
                return { profile: slice.profile, persona: slice.persona, slice: slice.slice, brief: slice.brief, result: '', evidence: [], failed: true, reason };
            } finally {
                abortSignal?.removeEventListener('abort', chainAbort);
            }
        }));
        if (outcomes.every((outcome) => outcome.failed)) {
            throw Object.assign(Error('Every coordinate slice failed'), {
                detail: { reasons: outcomes.map((outcome) => outcome.reason) },
            });
        }

        const reviewer = await this.spawnWorker(plan.review.profile);
        const review = await reviewer.understand(this.reviewBrief(plan, outcomes, turnId), abortSignal);
        if (!review) throw Error(`Reviewer paused without an interaction boundary: ${plan.review.profile}`);

        const answer = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.synthesisPrompt.section('synthesis') },
            { role: AgentChatRole.User, content: JSON.stringify({ outcomes, review: { profile: plan.review.profile, persona: plan.review.persona, result: review.answer, evidence: review.evidence }, hint: plan.synthesisHint }) },
        ], abortSignal);

        await this.context.settle(turnId, { assistant: answer, evidence: [...outcomes.flatMap((outcome) => outcome.evidence), ...review.evidence] }, abortSignal);
        const settled = this.context.turn(turnId);
        if (settled.status === 'working' && (abortSignal?.aborted || this.awareness.preempted?.(turnId))) throw new TurnPreempted(turnId);
        this.emit(SynapseSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: answer });
        this.emit(SynapseSignalType.Reply, { turnId, ...(streamId ? { streamId } : {}), chunk: null });
    }

    private addressedWrite(action: string, data: unknown): void {
        if (typeof data !== 'object' || data === null || !('turnId' in data)) {
            this.log.debug('synapse.addressed_write.no_turnId', { action });
            return;
        }
        const { turnId } = data as { turnId: string };
        const turn = this.context.turns.find((t) => t.id === turnId);
        if (!turn) {
            this.log.warn('synapse.addressed_write.turn_not_found', { action, turnId });
            return;
        }
        this.socket.write(turn.speakerId, { action, data });
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
        outcomes: CoordinateOutcome[],
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

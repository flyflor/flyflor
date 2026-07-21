import { Agent, AgentChatRole } from '@/agent';
import type { AgentInput } from '@/agent/types';
import { Context, type AgentBrief } from '@/agent/context';
import type { ConfigService } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, Prompt, PromptService, Scope, useContainer } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { parse } from '@/agent/json';
import type { CallosumSignal } from '@/agent/brain/callosum';
import { Awareness } from '@/neural/awareness';
import { DispositionRelation, type AttentionInstruction, type Stimulus } from '@/neural/awareness/types';
import { FSocket } from './ipc';
import {
    SynapseSignalType,
    TurnPreempted,
    type CoordinatePlan,
    type InteractionRequest,
    type InteractionResponse,
    type ReplyChunk,
    type SynapseSignal,
} from './types';

export interface AgentPool {
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
    @Config()
    public readonly config!: ConfigService;

    @Scope()
    public socket!: FSocket;

    @Inject()
    public context!: Context;

    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public awareness!: Awareness;

    @Prompt('prompts/synapse')
    public planPrompt!: PromptService;

    @Prompt('prompts/synapse')
    public synthesisPrompt!: PromptService;

    public agentPool: AgentPool;
    public active: string;
    private interactions = new Map<string, { request: InteractionRequest; resolve: (response: InteractionResponse) => void; reject: (error: Error) => void }>();
    private turnControllers = new Map<string, AbortController>();
    /** Controllers remain addressable before Context has created a Turn. */
    private stimulusControllers = new Map<string, { controller: AbortController; speakerId: string }>();

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
        this.awareness.attend(this);
        this.on(SynapseSignalType.Reply, (signal) => this.output(signal.data));
        this.on(SynapseSignalType.Event, (signal) => this.addressedWrite('data', signal.data));
        this.on(SynapseSignalType.Ask, (signal) => this.addressedWrite('ask', signal.data));
        this.on(SynapseSignalType.Confirm, (signal) => this.addressedWrite('confirm', signal.data));
        this.on(SynapseSignalType.Pause, (signal) => this.addressedWrite('pause', signal.data));
        this.on(SynapseSignalType.Resume, (signal) => this.addressedWrite('resume', signal.data));
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

    /** Awareness uses the same foreground boundary for a same-thread revision. */
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

    /** Cancel provider work for a turn after Awareness has marked it urgent. */
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

    /** Release interaction waiters and non-active Context turns for a departed speaker. */
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

    public async output(data: unknown) {
        const { turnId, chunk, streamId } = data as ReplyChunk;
        const turn = this.context.turns.find((t) => t.id === turnId);
        if (!turn) {
            this.log.warn('synapse.output.turn_not_found', { turnId });
            return;
        }
        this.awareness.speak(turnId, turn.speakerId, chunk, streamId);
    }

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
     * This single path plans, dispatches the agent pool,
     * and synthesizes the final reply through Synapse signals.
     * ZH: 皮层派发。Turn intent 判断需要多 agent 协同理解。本条路径一次性
     * 完成计划、派发 agent pool、合成最终回复，并通过 Synapse 信号输出。
     */
    public async coordinate(signal: CallosumSignal, turnId: string, abortSignal?: AbortSignal, streamId?: string): Promise<void> {
        const brief = this.context.brief(turnId);
        const plan = parse<CoordinatePlan>(await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.planPrompt.section('plan') },
            { role: AgentChatRole.User, content: `${JSON.stringify(brief)}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ], abortSignal));

        const outcomes: Array<{ profile: string; persona: string; slice: string; brief: string; result: string; evidence: string[] }> = [];
        const slices = plan.slices.length === 0
            ? [{ profile: this.active, persona: '', brief: this.context.brief(turnId).goal, slice: String(signal.chunk) }]
            : plan.slices;
        for (const slice of slices) {
            abortSignal?.throwIfAborted();
            const agent = await this.spawnWorker(slice.profile);
            const outcome = await agent.understand(this.workerBrief(slice, turnId), abortSignal);
            if (!outcome) throw Error(`Worker paused without an interaction boundary: ${slice.profile}`);
            outcomes.push({ profile: slice.profile, persona: slice.persona, slice: slice.slice, brief: slice.brief, result: outcome.answer, evidence: outcome.evidence });
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

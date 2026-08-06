import { Agent, type AgentInteractionRequest, type AgentInteractionResponse, type AgentReport, type AgentRuntimeEvent } from '@/agent';
import type { ConfigService, FAgentProfileConfiguration } from '@/configuration';
import { Config, FCortex, Init, Inject, Module, useContainer } from '@/core';
import type { AnswerInput, CancelInput } from '@/ipc/types';
import { Ledger } from '@/ledger';
import { createHash } from 'node:crypto';
import { Attention, type AttentionDecision } from './attention';
import { Context, type Focus, type Stimulus } from './context';
import { CollectiveSignalType, type AttentionReceipt, type CollectiveOutput, type CollectiveSignal, type CommandReceipt, type PendingInteraction } from './types';

interface ReceiptRecord {
    receipt: AttentionReceipt;
    payloadFingerprint: string;
}

interface CommandRecord {
    action: 'answer' | 'cancel';
    payloadFingerprint: string;
    receipt: CommandReceipt;
}

/**
 * EN: Owns the fixed roster, one-focus scheduler, cancellation revisions, and output routing.
 * It never performs model inference itself.
 * ZH: 持有固定成员、单焦点调度、取消 revision 与输出路由；自身不执行模型推理。
 */
@Module()
export class AgentManager extends FCortex<CollectiveSignal> {
    @Config()
    public config!: ConfigService;

    @Inject()
    public attention!: Attention;

    @Inject()
    public context!: Context;

    @Inject()
    public ledger!: Ledger;

    public readonly agents: Record<string, Agent> = {};
    private readonly receipts = new Map<string, ReceiptRecord>();
    private readonly commands = new Map<string, CommandRecord>();
    private readonly pendingUsers = new Map<string, number>();
    private intake: Promise<void> = Promise.resolve();
    private processing?: Promise<void>;
    private controller?: AbortController;
    private interaction?: PendingInteraction;
    private lastSpeakerId?: string;

    @Init()
    public async init(): Promise<void> {
        const profiles = this.profiles();
        for (const profile of Object.values(profiles)) {
            this.agents[profile.name] = await useContainer().getAsync(Agent, profile, this);
        }
        if (!this.agents[this.config.collective.leader]) throw Error('Collective leader is missing');
        this.on(CollectiveSignalType.AgentEvent, (signal) => this.forwardAgentEvent(signal.data as AgentRuntimeEvent));
    }

    public receive(stimulus: Stimulus): Promise<AttentionReceipt> {
        this.pendingUsers.set(stimulus.messageId, (this.pendingUsers.get(stimulus.messageId) ?? 0) + 1);
        const accepted = this.intake.then(() => this.accept(stimulus));
        this.intake = accepted.then(() => undefined, () => undefined);
        void accepted.then(
            () => this.releasePendingUser(stimulus.messageId),
            () => this.releasePendingUser(stimulus.messageId),
        );
        return accepted;
    }

    public disconnect(connectionId: string): void {
        this.context.disconnect(connectionId);
    }

    private async accept(stimulus: Stimulus): Promise<AttentionReceipt> {
        if (this.commands.has(stimulus.messageId)) {
            const receipt: AttentionReceipt = { messageId: stimulus.messageId, state: 'rejected', queueDepth: this.attention.size() };
            this.output('error', { messageId: stimulus.messageId, message: 'messageId is already bound to another action' }, [stimulus.connectionId]);
            return receipt;
        }
        const existing = this.receipts.get(stimulus.messageId);
        if (existing) {
            if (existing.payloadFingerprint !== this.userFingerprint(stimulus)) {
                const receipt: AttentionReceipt = { messageId: stimulus.messageId, state: 'rejected', queueDepth: this.attention.size() };
                this.output('error', { messageId: stimulus.messageId, message: 'messageId is already bound to another payload' }, [stimulus.connectionId]);
                return receipt;
            }
            this.context.reconnect(stimulus);
            this.attention.reconnect(stimulus.messageId, stimulus.speakerId, stimulus.connectionId);
            return structuredClone(existing.receipt);
        }
        this.ledger.recordStimulus(stimulus);
        try {
            const { active, decision } = await this.currentDecision(stimulus);
            if (!active) {
                const focus = this.context.open(stimulus, decision.consultants);
                const receipt = this.receipt(stimulus.messageId, 'focused', focus);
                this.remember(stimulus, receipt);
                this.status('focused', focus);
                this.start();
                return receipt;
            }
            if (decision.disposition === 'merge') {
                const focus = this.context.merge(stimulus, decision.consultants);
                const receipt = this.receipt(stimulus.messageId, 'merged', focus);
                this.remember(stimulus, receipt);
                this.output('responseReset', { focusId: focus.id, revision: focus.revision }, this.context.targets(focus.id));
                this.status('revising', focus);
                this.controller?.abort(Error('Focus revised'));
                return receipt;
            }
            this.attention.enqueue(stimulus, decision);
            const receipt: AttentionReceipt = {
                messageId: stimulus.messageId,
                state: 'queued',
                queueDepth: this.attention.size(),
            };
            this.remember(stimulus, receipt);
            this.status('queued', active);
            return receipt;
        } catch (error) {
            const receipt: AttentionReceipt = {
                messageId: stimulus.messageId,
                state: 'rejected',
                queueDepth: this.attention.size(),
            };
            this.remember(stimulus, receipt);
            this.output('error', { messageId: stimulus.messageId, message: this.message(error) }, [stimulus.connectionId]);
            return receipt;
        }
    }

    public answer(input: AnswerInput, connectionId?: string, messageId?: string): CommandReceipt {
        const repeated = this.repeatedCommand(messageId, 'answer', input);
        if (repeated) {
            this.reconnectCommand(input, connectionId);
            return repeated;
        }
        const pending = this.interaction;
        const focus = this.context.active();
        if (!pending || !focus) throw Error('No interaction is pending');
        if (focus.id !== input.focusId || pending.request.focusId !== input.focusId || pending.request.requestId !== input.requestId) {
            throw Error('Interaction response does not match pending request');
        }
        if (focus.ownerSpeakerId !== input.speakerId) throw Error('Only the focus owner may answer an interaction');
        if (pending.request.kind !== input.response.kind) throw Error('Interaction response kind does not match request');
        this.validateInteractionResponse(pending, input.response);
        if (connectionId) this.context.connect(focus.id, input.speakerId, connectionId);
        const receipt = this.rememberCommand(messageId, 'answer', input);
        this.ledger.recordInteraction(pending.request, input.response, input.speakerId, messageId);
        this.context.observeInteraction(focus.id, input.speakerId, messageId ?? input.requestId, input.response);
        this.interaction = undefined;
        this.context.resume(focus.id);
        pending.resolve(input.response);
        this.status('focused', this.context.active());
        return receipt;
    }

    public cancel(input: CancelInput, connectionId?: string, messageId?: string): CommandReceipt {
        const repeated = this.repeatedCommand(messageId, 'cancel', input);
        if (repeated) {
            this.reconnectCommand(input, connectionId);
            return repeated;
        }
        const focus = this.context.active();
        if (!focus || focus.id !== input.focusId) throw Error('Focus does not match cancellation');
        if (focus.ownerSpeakerId !== input.speakerId) throw Error('Only the focus owner may cancel');
        if (connectionId) this.context.connect(focus.id, input.speakerId, connectionId);
        const receipt = this.rememberCommand(messageId, 'cancel', input);
        this.ledger.recordCancellation(focus.id, focus.revision, input.speakerId);
        const targets = this.context.targets(focus.id);
        this.controller?.abort(Error('Focus cancelled'));
        this.interaction?.reject(Error('Focus cancelled'));
        this.interaction = undefined;
        this.context.cancel(focus.id);
        this.output('streamEnd', { focusId: focus.id, revision: focus.revision, cancelled: true }, targets);
        this.status('cancelled');
        this.start();
        return receipt;
    }

    public async interact(value: unknown): Promise<AgentInteractionResponse> {
        const request = value as AgentInteractionRequest;
        const focus = this.context.active();
        if (!focus || focus.id !== request.focusId || focus.revision !== request.revision) throw Error('Interaction focus is obsolete');
        if (request.agentId !== this.config.collective.leader) throw Error('Only the collective leader may interact');
        if (this.interaction) throw Error('An interaction is already pending');
        this.context.wait(focus.id);
        this.output(request.kind, {
            focusId: request.focusId,
            revision: request.revision,
            requestId: request.requestId,
            ...request.data as object,
        }, this.context.ownerTargets(focus.id));
        this.status('waiting', this.context.active());
        return await new Promise<AgentInteractionResponse>((resolve, reject) => {
            this.interaction = { request, resolve, reject };
        });
    }

    public async whenIdle(): Promise<void> {
        await this.intake;
        while (this.processing) await this.processing;
    }

    private start(): void {
        if (this.processing) return;
        this.processing = this.process().finally(() => {
            this.processing = undefined;
            if (this.context.active() || this.attention.size() > 0) this.start();
        });
    }

    private async process(): Promise<void> {
        while (true) {
            let focus = this.context.active();
            if (!focus) {
                const next = this.attention.next(this.lastSpeakerId);
                if (!next) {
                    this.status('idle');
                    return;
                }
                focus = this.context.open(next.stimulus, next.consultants);
                const sources = [next, ...this.attention.takeReplies([next.stimulus.messageId])];
                for (const source of sources.slice(1)) {
                    focus = this.context.merge(source.stimulus, source.consultants);
                }
                for (const source of sources) {
                    this.output('event', {
                        type: 'focus',
                        messageId: source.stimulus.messageId,
                        focusId: focus.id,
                        revision: focus.revision,
                    }, [source.stimulus.connectionId]);
                }
                this.status('focused', focus);
            }
            if (focus.state === 'cancelled') {
                this.context.releaseCancelled(focus.id);
                continue;
            }
            try {
                await this.runRevision(focus);
            } catch (error) {
                const active = this.context.active();
                if (!active) continue;
                if (active.state === 'cancelled') {
                    this.context.releaseCancelled(active.id);
                    continue;
                }
                if (active.id === focus.id && active.revision !== focus.revision) continue;
                const targets = this.context.targets(active.id);
                await this.context.complete(active.id, {
                    agentId: this.config.collective.leader,
                    answer: '',
                    evidence: [],
                    decisions: [],
                    remaining: [this.message(error)],
                    steps: 0,
                });
                this.output('error', { focusId: active.id, revision: active.revision, message: this.message(error) }, targets);
                this.output('streamEnd', { focusId: active.id, revision: active.revision, failed: true }, targets);
            }
        }
    }

    private async runRevision(focus: Focus): Promise<void> {
        this.controller = new AbortController();
        const control = this.controller;
        const specialists = focus.consultants
            .filter((name) => name !== this.config.collective.leader)
            .map((name) => this.agents[name])
            .filter((agent): agent is Agent => agent !== undefined);
        const reports = await Promise.all(specialists.map(async (agent): Promise<AgentReport> => {
            try {
                return await agent.run(this.context.forAgent(agent.agentConfig.name, agent.memory(), this.contextCapacity(agent.agentConfig)), {
                    focusId: focus.id,
                    revision: focus.revision,
                    signal: control.signal,
                    stream: false,
                    onChunk: () => undefined,
                });
            } catch (error) {
                if (control.signal.aborted) throw error;
                return {
                    agentId: agent.agentConfig.name,
                    answer: '',
                    evidence: [],
                    decisions: [],
                    remaining: [`Specialist failed: ${this.message(error)}`],
                    steps: 0,
                };
            }
        }));
        this.ensureRevision(focus, control.signal);
        for (const report of reports) this.context.observe(focus.id, report);

        const leader = this.agents[this.config.collective.leader]!;
        const report = await leader.run(this.context.forAgent(leader.agentConfig.name, leader.memory(), this.contextCapacity(leader.agentConfig)), {
            focusId: focus.id,
            revision: focus.revision,
            signal: control.signal,
            stream: true,
            onChunk: (chunk) => {
                if (!this.currentRevision(focus) || control.signal.aborted) return;
                this.output('agent', { focusId: focus.id, revision: focus.revision, chunk }, this.context.targets(focus.id));
            },
        });
        this.ensureRevision(focus, control.signal);
        const targets = this.context.targets(focus.id);
        await this.context.complete(focus.id, report);
        this.lastSpeakerId = focus.ownerSpeakerId;
        this.output('streamEnd', { focusId: focus.id, revision: focus.revision, cancelled: false }, targets);
        this.status('completed');
    }

    private ensureRevision(focus: Focus, signal: AbortSignal): void {
        if (signal.aborted || !this.currentRevision(focus)) throw signal.reason ?? Error('Focus revision is obsolete');
    }

    private currentRevision(focus: Focus): boolean {
        const active = this.context.active();
        return active?.id === focus.id && active.revision === focus.revision;
    }

    private profiles(): Record<string, FAgentProfileConfiguration> {
        return Object.fromEntries(Object.entries(this.config.agents).map(([name, value]) => {
            const leader = name === this.config.collective.leader;
            const profile: FAgentProfileConfiguration = {
                ...value,
                name,
                role: value.role ?? (leader ? 'leader' : 'specialist'),
                description: value.description ?? name,
                capabilities: value.capabilities ?? [],
                actionScope: leader ? (value.actionScope ?? 'full') : 'read',
                model: value.model || this.config.model.model || this.config.model.default,
                provider: value.provider || this.config.model.provider,
                contextLength: value.contextLength || this.config.model.contextLength,
                maxTokens: value.maxTokens || this.config.model.maxTokens,
            };
            return [name, profile];
        }));
    }

    private forwardAgentEvent(event: AgentRuntimeEvent): void {
        this.ledger.recordAgentEvent(event);
        const focus = this.context.active();
        if (!focus || focus.id !== event.focusId) return;
        if (focus.state === 'cancelled') {
            const evidence = this.eventEvidence(event);
            if (evidence) this.context.observeAction(focus.id, event.agentId, evidence);
            return;
        }
        if (focus.revision !== event.revision) {
            const evidence = this.eventEvidence(event);
            if (evidence) this.context.observeAction(focus.id, event.agentId, evidence);
            return;
        }
        this.output('event', event, this.context.targets(focus.id));
        this.status(event.type === 'action_start' ? 'acting' : 'focused', focus);
    }

    private receipt(messageId: string, state: AttentionReceipt['state'], focus: Focus): AttentionReceipt {
        return { messageId, state, focusId: focus.id, revision: focus.revision, queueDepth: this.attention.size() };
    }

    private async currentDecision(stimulus: Stimulus): Promise<{ active: Focus | undefined; decision: AttentionDecision }> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const active = this.context.active();
            const decision = await this.attention.decide(stimulus, active, this.profiles());
            if (this.sameFocus(active, this.context.active())) return { active, decision };
        }
        const active = this.context.active();
        return {
            active,
            decision: { disposition: active ? 'queue' : 'focus', salience: 0.5, consultants: [] },
        };
    }

    private sameFocus(left: Focus | undefined, right: Focus | undefined): boolean {
        return left?.id === right?.id && left?.revision === right?.revision && left?.state === right?.state;
    }

    private remember(stimulus: Stimulus, receipt: AttentionReceipt): void {
        this.receipts.set(stimulus.messageId, {
            receipt: structuredClone(receipt),
            payloadFingerprint: this.userFingerprint(stimulus),
        });
    }

    private contextCapacity(profile: FAgentProfileConfiguration): number {
        const inputTokens = Math.max(0, profile.contextLength - profile.maxTokens);
        return Math.min(this.config.collective.contextCharLimit, inputTokens * 2);
    }

    private eventEvidence(event: AgentRuntimeEvent): string | undefined {
        return event.type === 'action_result'
            && typeof event.data === 'object'
            && event.data !== null
            && typeof (event.data as { evidence?: unknown }).evidence === 'string'
            ? (event.data as { evidence: string }).evidence
            : undefined;
    }

    private repeatedCommand(messageId: string | undefined, action: CommandRecord['action'], input: AnswerInput | CancelInput): CommandReceipt | undefined {
        if (!messageId) return undefined;
        const existing = this.commands.get(messageId);
        if (existing) {
            if (existing.action !== action || existing.payloadFingerprint !== this.fingerprint(JSON.stringify(input))) throw Error('messageId is already bound to another payload');
            return structuredClone(existing.receipt);
        }
        if (this.receipts.has(messageId) || this.pendingUsers.has(messageId)) throw Error('messageId is already bound to another action');
        return undefined;
    }

    private rememberCommand(messageId: string | undefined, action: CommandRecord['action'], input: AnswerInput | CancelInput): CommandReceipt {
        const receipt: CommandReceipt = { messageId: messageId ?? input.focusId, action, state: 'accepted' };
        if (messageId) this.commands.set(messageId, {
            action,
            payloadFingerprint: this.fingerprint(JSON.stringify(input)),
            receipt: structuredClone(receipt),
        });
        return receipt;
    }

    private reconnectCommand(input: AnswerInput | CancelInput, connectionId?: string): void {
        const focus = this.context.active();
        if (connectionId && focus?.id === input.focusId && focus.ownerSpeakerId === input.speakerId) {
            this.context.connect(focus.id, input.speakerId, connectionId);
        }
    }

    private releasePendingUser(messageId: string): void {
        const pending = this.pendingUsers.get(messageId);
        if (pending === undefined || pending <= 1) this.pendingUsers.delete(messageId);
        else this.pendingUsers.set(messageId, pending - 1);
    }

    private validateInteractionResponse(pending: PendingInteraction, response: AgentInteractionResponse): void {
        if (response.kind !== 'ask') return;
        const data = pending.request.data as { questions?: unknown };
        if (!Array.isArray(data?.questions)) throw Error('Pending ask request is invalid');
        const questions = data.questions.map((item) => (
            typeof item === 'object' && item !== null && typeof (item as { question?: unknown }).question === 'string'
                ? (item as { question: string }).question
                : undefined
        ));
        if (questions.some((question) => question === undefined)) throw Error('Pending ask request is invalid');
        if (response.answers.length !== questions.length || response.answers.some((answer, index) => answer.question !== questions[index])) {
            throw Error('Ask response does not match pending questions');
        }
    }

    private userFingerprint(stimulus: Stimulus): string {
        return this.fingerprint(JSON.stringify({
            speakerId: stimulus.speakerId,
            text: stimulus.text,
            replyTo: stimulus.replyTo,
        }));
    }

    private fingerprint(payload: string): string {
        return createHash('sha256').update(payload).digest('hex');
    }

    private status(state: string, focus?: Focus): void {
        const active = focus ?? this.context.active();
        this.output('attention', {
            state,
            busy: active !== undefined,
            queueDepth: this.attention.size(),
        });
    }

    private output(action: CollectiveOutput['action'], data: unknown, targets?: string[]): void {
        this.emit(CollectiveSignalType.Output, { action, data, targets } satisfies CollectiveOutput);
    }

    private message(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

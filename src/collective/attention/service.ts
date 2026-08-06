import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import { AgentChatRole } from '@/agent/types';
import { Config, FService, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Inference, parse } from '@/inference';
import type { Focus, Stimulus } from '@/collective/context';
import type { AttentionDecision, QueuedStimulus } from './types';

interface AttentionModelDecision {
    relation?: unknown;
    salience?: unknown;
    consultants?: unknown;
}

interface AttentionModelInput {
    stimulus: { speakerId: string; text: string; replyTo?: string };
    active: null | {
        id: string;
        ownerSpeakerId: string;
        goal: string;
        messages: Array<{ messageId: string; speakerId: string; text: string }>;
    };
    roster: Array<{ name: string; role: string; description: string; capabilities: string[] }>;
}

/**
 * EN: Gates stimuli into one process-wide focus and owns the fair waiting queue.
 * ZH: 把刺激门控到唯一进程级焦点，并持有公平等待队列。
 */
@Singleton()
export class Attention extends FService {
    @Config()
    public config!: ConfigService;

    @Inject(() => [undefined])
    public inference!: Inference;

    @Prompt('prompts/attention')
    public prompt!: PromptService;

    private readonly waiting: QueuedStimulus[] = [];

    public async decide(
        stimulus: Stimulus,
        focus: Focus | undefined,
        roster: Record<string, FAgentProfileConfiguration>,
        signal?: AbortSignal,
    ): Promise<AttentionDecision> {
        if (focus && focus.state !== 'working') return { disposition: 'queue', salience: 0.5, consultants: [] };
        if (focus && stimulus.replyTo && focus.stimuli.some((item) => item.messageId === stimulus.replyTo)) {
            return { disposition: 'merge', salience: 1, consultants: focus.consultants };
        }
        try {
            const raw = await this.inference.completeText([
                { role: AgentChatRole.System, content: this.prompt.section('FOCUS') },
                {
                    role: AgentChatRole.User,
                    content: this.modelInput(stimulus, focus, roster),
                },
            ], signal);
            return this.normalize(parse<AttentionModelDecision>(raw), focus, roster);
        } catch (error) {
            if (signal?.aborted) throw error;
            this.log.warn('attention.fallback', { error: error instanceof Error ? error.message : String(error) });
            return { disposition: focus ? 'queue' : 'focus', salience: 0.5, consultants: [] };
        }
    }

    public enqueue(stimulus: Stimulus, decision: AttentionDecision): void {
        if (this.waiting.length >= this.config.collective.queueLimit) throw Error('Attention queue is full');
        this.waiting.push({
            stimulus: structuredClone(stimulus),
            salience: decision.salience,
            consultants: [...decision.consultants],
            queuedAt: Date.now(),
        });
    }

    public next(lastSpeakerId?: string): QueuedStimulus | undefined {
        if (this.waiting.length === 0) return undefined;
        const now = Date.now();
        let selected = 0;
        let score = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < this.waiting.length; index += 1) {
            const candidate = this.waiting[index]!;
            const age = Math.min(1, (now - candidate.queuedAt) / 30000);
            const fairness = candidate.stimulus.speakerId === lastSpeakerId ? 0 : 0.25;
            const current = candidate.salience + age + fairness;
            if (current > score) {
                selected = index;
                score = current;
            }
        }
        return this.waiting.splice(selected, 1)[0];
    }

    public takeReplies(messageIds: string[]): QueuedStimulus[] {
        const related: QueuedStimulus[] = [];
        const sources = new Set(messageIds);
        let found = true;
        while (found) {
            found = false;
            for (let index = 0; index < this.waiting.length; index += 1) {
                const candidate = this.waiting[index]!;
                if (!candidate.stimulus.replyTo || !sources.has(candidate.stimulus.replyTo)) continue;
                this.waiting.splice(index, 1);
                related.push(candidate);
                sources.add(candidate.stimulus.messageId);
                found = true;
                index -= 1;
            }
        }
        return related;
    }

    public size(): number {
        return this.waiting.length;
    }

    public reconnect(messageId: string, speakerId: string, connectionId: string): void {
        const queued = this.waiting.find((item) => item.stimulus.messageId === messageId && item.stimulus.speakerId === speakerId);
        if (queued) queued.stimulus.connectionId = connectionId;
    }

    private modelInput(
        stimulus: Stimulus,
        focus: Focus | undefined,
        roster: Record<string, FAgentProfileConfiguration>,
    ): string {
        const limit = Math.max(512, this.config.collective.contextCharLimit || 32000);
        const textLimit = Math.max(64, Math.floor(limit / 4));
        const messageLimit = Math.max(64, Math.floor(limit / 32));
        const stimuli = focus?.stimuli ?? [];
        const messages = stimuli.length <= 16
            ? stimuli
            : [stimuli[0]!, ...stimuli.slice(-15)];
        const input: AttentionModelInput = {
            stimulus: {
                speakerId: this.bounded(stimulus.speakerId, 128),
                text: this.bounded(stimulus.text, textLimit),
                replyTo: stimulus.replyTo === undefined ? undefined : this.bounded(stimulus.replyTo, 128),
            },
            active: focus ? {
                id: this.bounded(focus.id, 128),
                ownerSpeakerId: this.bounded(focus.ownerSpeakerId, 128),
                goal: this.bounded(focus.goal, textLimit),
                messages: messages.map((item) => ({
                    messageId: this.bounded(item.messageId, 128),
                    speakerId: this.bounded(item.speakerId, 128),
                    text: this.bounded(item.text, messageLimit),
                })),
            } : null,
            roster: Object.values(roster).slice(0, 32).map((profile) => ({
                name: this.bounded(profile.name, 128),
                role: profile.role,
                description: this.bounded(profile.description, 256),
                capabilities: profile.capabilities.slice(0, 16).map((capability) => this.bounded(capability, 128)),
            })),
        };
        let content = JSON.stringify(input);
        while (content.length > limit && input.active && input.active.messages.length > 2) {
            input.active.messages.splice(1, 1);
            content = JSON.stringify(input);
        }
        while (content.length > limit && input.roster.length > 0) {
            input.roster.pop();
            content = JSON.stringify(input);
        }
        if (content.length <= limit) return content;
        return JSON.stringify({
            stimulus: { text: this.bounded(stimulus.text, 128) },
            active: focus ? { goal: this.bounded(focus.goal, 128) } : null,
            roster: [],
        });
    }

    private bounded(value: string, limit: number): string {
        return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
    }

    private normalize(
        value: AttentionModelDecision,
        focus: Focus | undefined,
        roster: Record<string, FAgentProfileConfiguration>,
    ): AttentionDecision {
        const relation = value.relation;
        const disposition = focus === undefined
            ? 'focus'
            : relation === 'merge'
                ? 'merge'
                : 'queue';
        const salience = typeof value.salience === 'number' && Number.isFinite(value.salience)
            ? Math.max(0, Math.min(1, value.salience))
            : 0.5;
        const consultants = Array.isArray(value.consultants)
            ? [...new Set(value.consultants.filter((name): name is string => (
                typeof name === 'string'
                && roster[name]?.role === 'specialist'
            )))]
            : [];
        return { disposition, salience, consultants };
    }
}

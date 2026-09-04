import type { FAgentProfileConfiguration, ConfigService } from '@/configuration';
import { AgentChatRole } from '@/agent/types';
import { Config, FService, Prompt, PromptService, Singleton } from '@/core';
import { Inference, Model, parse } from '@/inference';
import type { Focus, Stimulus } from '@/collective/context';
import type { Spike } from './types';

interface SpikeModelDecision {
    relation?: unknown;
    salience?: unknown;
    consultants?: unknown;
}

interface SpikeModelInput {
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
 * EN: The scout (侦察者): the collective's salience detector. Every inbound stimulus is
 * reconnoitered here and discharged as a `Spike` — the cortical firing signal the Cortex
 * reacts to. Detection is a Chain of Responsibility: the waiting gate, the explicit reply
 * chain, the model classifier (Strategy), then a deterministic fallback. The scout itself
 * never acts; it only fires.
 * ZH: 侦察者：群体的显著性探测器。每条入站刺激在此完成侦察，并以 `Spike`（放电信号）释放，
 * 皮层据此反应。检测是一条责任链：等待闸门 → 显式 reply 链 → 模型分类（策略）→ 确定性回退。
 * 侦察者只放电，从不行动。
 */
@Singleton()
export class Scout extends FService {
    @Config()
    public config!: ConfigService;

    @Model()
    public inference!: Inference;

    @Prompt('prompts/scout')
    public prompt!: PromptService;

    /**
     * EN: Detects one stimulus and discharges its spike.
     * ZH: 侦察一条刺激并释放其放电信号。
     */
    public async detect(
        stimulus: Stimulus,
        focus: Focus | undefined,
        roster: Record<string, FAgentProfileConfiguration>,
        signal?: AbortSignal,
    ): Promise<Spike> {
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
            return this.normalize(parse<SpikeModelDecision>(raw), focus, roster);
        } catch (error) {
            if (signal?.aborted) throw error;
            this.log.warn('scout.fallback', { error: error instanceof Error ? error.message : String(error) });
            return { disposition: focus ? 'queue' : 'focus', salience: 0.5, consultants: [] };
        }
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
        const input: SpikeModelInput = {
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
        value: SpikeModelDecision,
        focus: Focus | undefined,
        roster: Record<string, FAgentProfileConfiguration>,
    ): Spike {
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

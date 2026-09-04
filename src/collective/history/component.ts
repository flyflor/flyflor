import { AgentChatRole, type AgentReport } from '@/agent/types';
import type { Focus } from '@/collective/context/types';
import type { ConfigService } from '@/configuration';
import { Config, FComponent, Inject, Prompt, PromptService, Singleton } from '@/core';
import { Inference, Model } from '@/inference';
import type { DialogueTurn, DialogueTurnMessage } from './types';

const MAX_TURN_CHARS = 6000;

/**
 * EN: Process-wide volatile dialogue history. It keeps recently completed turns verbatim, bounded by a
 * character budget derived from the leader model's context window. Nothing is ever truncated: an
 * oversized turn is compressed by the model, and turns that age past the budget are folded into a
 * condensed digest. When compression is unavailable the original turns are kept as they are.
 * ZH: 进程级易失对话历史。按 leader 模型上下文窗口推导的字符预算逐字保留最近完成的轮次。
 * 任何内容都不会被截断：超长轮次由模型压缩，超出预算的旧轮次折叠为浓缩摘要；
 * 压缩不可用时原样保留全部轮次。
 */
@Singleton()
export class History extends FComponent {
    @Config()
    public config!: ConfigService;

    @Model()
    public inference!: Inference;

    @Prompt('prompts/history')
    public prompt!: PromptService;

    private readonly turns: DialogueTurn[] = [];

    public async record(focus: Focus, report: AgentReport): Promise<void> {
        this.turns.push(await this.fit({
            focusId: focus.id,
            messages: focus.stimuli.map((stimulus) => ({ speakerId: stimulus.speakerId, text: stimulus.text })),
            answer: report.answer,
            agentId: report.agentId,
            createdAt: Date.now(),
        }));
        await this.compact();
    }

    public recent(limitChars: number): DialogueTurn[] {
        const limit = Math.max(0, limitChars);
        const selected: DialogueTurn[] = [];
        let chars = 0;
        for (let index = this.turns.length - 1; index >= 0; index -= 1) {
            const size = JSON.stringify(this.turns[index]).length + 1;
            if (chars + size > limit) continue;
            selected.push(this.turns[index]!);
            chars += size;
        }
        return structuredClone(selected.reverse());
    }

    public snapshot(): DialogueTurn[] {
        return structuredClone(this.turns);
    }

    private retentionChars(): number {
        const leader = this.config.agents?.[this.config.collective.leader];
        const contextLength = leader?.contextLength || this.config.model.contextLength;
        const maxTokens = leader?.maxTokens || this.config.model.maxTokens;
        const capacity = Math.min(this.config.collective.contextCharLimit, Math.max(0, contextLength - maxTokens) * 2);
        return Math.floor(capacity * this.share());
    }

    private share(): number {
        return Math.max(0, Math.min(1, this.config.collective.historyShare));
    }

    private totalChars(): number {
        return this.turns.reduce((chars, turn) => chars + JSON.stringify(turn).length + 1, 0);
    }

    private async fit(turn: DialogueTurn): Promise<DialogueTurn> {
        if (JSON.stringify(turn).length <= MAX_TURN_CHARS) return turn;
        const answerLimit = Math.floor(MAX_TURN_CHARS / 2);
        const messageLimit = Math.max(64, Math.floor(MAX_TURN_CHARS / 2 / Math.max(1, turn.messages.length)));
        const messages: DialogueTurnMessage[] = [];
        for (const message of turn.messages) {
            messages.push({ ...message, text: await this.compressText(message.text, messageLimit) });
        }
        return { ...turn, messages, answer: await this.compressText(turn.answer, answerLimit) };
    }

    private async compressText(text: string, limit: number): Promise<string> {
        if (text.length <= limit) return text;
        const compressed = await this.digest({ targetChars: limit, text });
        return compressed !== undefined && compressed.length < text.length ? compressed : text;
    }

    private async compact(): Promise<void> {
        const limit = this.retentionChars();
        while (this.totalChars() > limit) {
            const verbatim = this.turns.filter((turn) => !turn.condensed).length;
            if (verbatim <= 1) return;
            const before = this.totalChars();
            await this.fold(Math.max(1, Math.ceil(verbatim / 2)));
            if (this.totalChars() >= before) return;
        }
    }

    private async fold(count: number): Promise<void> {
        const head = this.turns[0]?.condensed ? this.turns.shift()! : undefined;
        const batch = this.turns.splice(0, count);
        const folded = [...(head ? [head] : []), ...batch];
        const sourceChars = folded.reduce((chars, turn) => chars + JSON.stringify(turn).length + 1, 0);
        const digest = await this.digest({ targetChars: Math.floor(sourceChars / 2), turns: folded });
        if (digest === undefined || digest.length >= sourceChars) {
            this.turns.unshift(...batch);
            if (head) this.turns.unshift(head);
            return;
        }
        this.turns.unshift({
            focusId: folded[0]!.focusId,
            messages: [],
            answer: digest,
            agentId: folded.at(-1)!.agentId,
            createdAt: folded.at(-1)!.createdAt,
            condensed: true,
        });
    }

    private async digest(input: unknown): Promise<string | undefined> {
        try {
            const result = await this.inference.completeText([
                { role: AgentChatRole.System, content: this.prompt.section('COMPACT') },
                { role: AgentChatRole.User, content: JSON.stringify(input) },
            ]);
            return result.trim() || undefined;
        } catch (error) {
            this.log.warn('history.compressFallback', { error: error instanceof Error ? error.message : String(error) });
            return undefined;
        }
    }
}

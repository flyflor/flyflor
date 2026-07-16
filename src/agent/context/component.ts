import { FComponent, Singleton, useContainer } from '@/core';
import { Turn } from './entity';
import type { ContextBrief, Perception, TurnInteraction, TurnSummary } from './types';

/**
 * ZH: 持续存活的智能生命体所经历全部 Turn 的唯一所有者。
 * EN: Sole owner of every Turn experienced by the continuously living life form.
 */
@Singleton()
export class Context extends FComponent {
    private sequence: number;
    private readonly capacity: number;
    private readonly turns: Turn[];
    private active?: Turn;

    /** ZH: 一次性创建空的生命体经历状态。 EN: Creates empty life-form experience state once. */
    public constructor() {
        super();
        this.sequence = 0;
        this.capacity = 32;
        this.turns = [];
        this.active = undefined;
    }

    /**
     * ZH: 开始一个 Turn，并返回面向 Agent 的不可变 brief。
     * EN: Begins one Turn and returns its immutable Agent-facing brief.
     */
    public begin(input: string, perception: Perception): ContextBrief {
        if (this.active) throw Error('A Turn is already active');
        if (input.length === 0) throw Error('Turn input is empty');
        this.sequence += 1;
        this.active = useContainer().create(Turn, `turn_${this.sequence}`, input, perception, Date.now());
        this.turns.push(this.active);
        return this.active.brief(this.recent());
    }

    /**
     * ZH: 返回指定活动 Turn 的不可变 brief。
     * EN: Returns an immutable brief for the active Turn with the requested id.
     */
    public brief(turnId: string): ContextBrief {
        if (!this.active || this.active.id !== turnId) throw Error(`Active Turn not found: ${turnId}`);
        return this.active.brief(this.recent());
    }

    /**
     * ZH: 为一次用户交互暂停活动 Turn。
     * EN: Pauses the active Turn for one user interaction.
     */
    public pause(turnId: string, interaction: TurnInteraction): void {
        this.requireActive(turnId).pause(interaction);
    }

    /**
     * ZH: 在一个精确用户交互后恢复活动 Turn。
     * EN: Resumes the active Turn after one exact user interaction.
     */
    public resume(turnId: string, interactionId: string): void {
        this.requireActive(turnId).resume(interactionId);
    }

    /**
     * ZH: 将一个 Agent Complete 保存为最终 Turn 摘要，并裁剪有界历史。
     * EN: Stores one Agent Complete as the final Turn summary and trims bounded history.
     */
    public complete(turnId: string, answer: string, evidence: readonly string[]): TurnSummary {
        const turn = this.requireActive(turnId);
        turn.complete(answer, evidence);
        this.active = undefined;
        this.trim();
        return turn.summary();
    }

    /**
     * ZH: 返回最近完成 Turns 的不可变摘要。
     * EN: Returns immutable summaries of the latest completed Turns.
     */
    public recent(limit = 4): TurnSummary[] {
        if (!Number.isInteger(limit) || limit < 0) throw Error('Recent Turn limit must be a non-negative integer');
        if (limit === 0) return [];
        const bound = Math.min(limit, this.capacity);
        return this.turns.filter((turn) => turn.completed()).slice(-bound).map((turn) => turn.summary());
    }

    /**
     * ZH: 在超过有限容量时淘汰最旧已完成 Turn；永不丢弃活动 Turn。
     * EN: Evicts oldest completed Turns past finite capacity; never drops the active Turn.
     */
    private trim(): void {
        const drop = this.turns.length - this.capacity;
        if (drop > 0) this.turns.splice(0, drop);
    }

    /**
     * ZH: 返回活动 Turn，或拒绝不匹配的 id。
     * EN: Returns the active Turn or rejects a mismatched id.
     */
    private requireActive(turnId: string): Turn {
        if (!this.active || this.active.id !== turnId) throw Error(`Active Turn not found: ${turnId}`);
        return this.active;
    }
}

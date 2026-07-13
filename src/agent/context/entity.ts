import type { ContextBrief, Perception, TurnInteraction, TurnSummary } from './types';

type TurnStatus = 'active' | 'paused' | 'completed';

/**
 * EN: Internal conversational entity reachable only through Context.
 * ZH: 只能通过 Context 访问的内部对话实体。
 */
export class Turn {
    private status: TurnStatus;
    private interaction?: TurnInteraction;
    private answer?: string;
    private evidence: string[];

    /**
     * EN: Creates one active experience from raw input and one perception.
     * ZH: 从原始输入和一次感知创建一条活动经历。
     */
    public constructor(
        public readonly id: string,
        public readonly input: string,
        public readonly perception: Perception,
        public readonly createdAt: number,
    ) {
        this.status = 'active';
        this.interaction = undefined;
        this.answer = undefined;
        this.evidence = [];
    }

    /**
     * EN: Marks this Turn as waiting for one exact interaction.
     * ZH: 将当前 Turn 标记为等待一个精确交互。
     */
    public pause(interaction: TurnInteraction): void {
        this.assert('active');
        this.status = 'paused';
        this.interaction = { ...interaction };
    }

    /**
     * EN: Resumes this Turn after its exact interaction is answered.
     * ZH: 在精确交互得到回答后恢复当前 Turn。
     */
    public resume(interactionId: string): void {
        this.assert('paused');
        if (this.interaction?.id !== interactionId) throw Error(`Turn interaction does not match: ${this.id}`);
        this.status = 'active';
        this.interaction = undefined;
    }

    /**
     * EN: Completes this Turn with the Agent's final answer and evidence.
     * ZH: 使用 Agent 的最终回答和证据完成当前 Turn。
     */
    public complete(answer: string, evidence: readonly string[]): void {
        this.assert('active');
        if (answer.trim().length === 0) throw Error(`Turn answer is empty: ${this.id}`);
        this.status = 'completed';
        this.answer = answer;
        this.evidence = [...evidence];
        this.interaction = undefined;
    }

    /**
     * EN: Projects this active or paused Turn into an immutable Agent brief.
     * ZH: 将活动或暂停 Turn 投影为不可变 Agent brief。
     */
    public brief(recent: TurnSummary[]): ContextBrief {
        if (this.status === 'completed') throw Error(`Turn is already completed: ${this.id}`);
        return {
            turnId: this.id,
            input: this.input,
            goal: this.perception.goal,
            constraints: [...this.perception.constraints],
            references: this.perception.references.map((reference) => ({ ...reference })),
            cwd: this.perception.cwd,
            recent: recent.map((summary) => ({ ...summary, evidence: [...summary.evidence] })),
        };
    }

    /**
     * EN: Projects this completed Turn into an immutable retained summary.
     * ZH: 将完成的 Turn 投影为不可变保留摘要。
     */
    public summary(): TurnSummary {
        this.assert('completed');
        if (this.answer === undefined) throw Error(`Turn answer is missing: ${this.id}`);
        return {
            turnId: this.id,
            input: this.input,
            goal: this.perception.goal,
            answer: this.answer,
            evidence: [...this.evidence],
            createdAt: this.createdAt,
        };
    }

    /**
     * EN: Reports whether this Turn has reached its final state.
     * ZH: 报告当前 Turn 是否已到达最终状态。
     */
    public completed(): boolean {
        return this.status === 'completed';
    }

    /**
     * EN: Rejects an invalid Turn transition.
     * ZH: 拒绝非法 Turn 状态迁移。
     */
    private assert(expected: TurnStatus): void {
        if (this.status !== expected) throw Error(`Turn ${this.id} is ${this.status}, expected ${expected}`);
    }
}

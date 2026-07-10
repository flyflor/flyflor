import type { Perception, TurnInteraction, TurnSnapshot, TurnStatus } from './types';

/**
 * EN: Canonical state for one user turn. State transitions stay on the entity so
 * no service can leave a partially updated turn behind.
 * ZH: 单个用户回合的唯一状态。状态转换由实体自身持有，避免服务留下半更新回合。
 */
export class Turn {
    public status: TurnStatus = 'active';
    public answer = '';
    public evidence: string[] = [];
    public interaction?: TurnInteraction;
    public error?: string;
    public readonly createdAt = Date.now();
    public updatedAt = this.createdAt;

    public constructor(
        public readonly id: string,
        public readonly input: string,
        public readonly perception: Perception,
    ) {}

    public pause(interaction: TurnInteraction): void {
        this.assert('active');
        this.status = 'paused';
        this.interaction = interaction;
        this.touch();
    }

    public resume(interactionId: string): void {
        this.assert('paused');
        if (this.interaction?.id !== interactionId) throw Error(`Interaction does not match turn: ${this.id}`);
        this.status = 'active';
        delete this.interaction;
        this.touch();
    }

    public complete(answer: string, evidence: string[] = []): void {
        this.assert('active');
        this.status = 'completed';
        this.answer = answer;
        this.evidence = [...evidence];
        delete this.interaction;
        this.touch();
    }

    public fail(error: unknown): void {
        if (this.status === 'completed' || this.status === 'failed') return;
        this.status = 'failed';
        this.error = error instanceof Error ? error.message : String(error);
        delete this.interaction;
        this.touch();
    }

    public snapshot(): TurnSnapshot {
        return {
            id: this.id,
            input: this.input,
            mode: this.perception.mode,
            goal: this.perception.goal,
            cwd: this.perception.cwd,
            constraints: [...this.perception.constraints],
            references: this.perception.references.map((reference) => ({ ...reference })),
            status: this.status,
            answer: this.answer,
            evidence: [...this.evidence],
            interaction: this.interaction ? { ...this.interaction } : undefined,
            error: this.error,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }

    private assert(expected: TurnStatus): void {
        if (this.status !== expected) throw Error(`Turn ${this.id} is ${this.status}, expected ${expected}`);
    }

    private touch(): void {
        this.updatedAt = Date.now();
    }
}

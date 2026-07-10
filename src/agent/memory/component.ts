import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { FComponent, Singleton, useContainer } from '@/core';
import { Turn, type Perception, type TurnInteraction, type TurnSnapshot } from '../turn';

/**
 * EN: Memory is the only owner of turn continuity for the active life form.
 * ZH: Memory 是当前生命体回合连续性的唯一所有者。
 */
@Singleton()
export class Memory extends FComponent {
    private sequence = 0;
    private readonly turns: Turn[] = [];

    public begin(input: string, perception: Perception): Turn {
        if (this.current()) throw Error('A turn is already active');
        this.sequence += 1;
        const turn = useContainer().create(Turn, `turn_${this.sequence}`, input, perception);
        this.turns.push(turn);
        return turn;
    }

    public turn(id: string): Turn {
        const turn = this.turns.find((candidate) => candidate.id === id);
        if (!turn) throw Error(`Turn not found: ${id}`);
        return turn;
    }

    public current(): Turn | undefined {
        return this.turns.findLast((turn) => turn.status === 'active' || turn.status === 'paused');
    }

    public recent(limit = 4): TurnSnapshot[] {
        return this.turns
            .filter((turn) => turn.status === 'completed')
            .slice(-limit)
            .map((turn) => turn.snapshot());
    }

    public context(turnId?: string): { current?: TurnSnapshot; recent: TurnSnapshot[] } {
        const current = turnId ? this.turn(turnId) : this.current();
        return { current: current?.snapshot(), recent: this.recent() };
    }

    public messages(limit = 4): AgentMemory[] {
        return this.recent(limit).flatMap((turn) => [
            { role: AgentChatRole.User, content: turn.input },
            { role: AgentChatRole.Assistant, content: turn.answer },
        ]);
    }

    public pause(turnId: string, interaction: TurnInteraction): void {
        this.turn(turnId).pause(interaction);
    }

    public resume(turnId: string, interactionId: string): void {
        this.turn(turnId).resume(interactionId);
    }

    public complete(turnId: string, answer: string, evidence: string[] = []): Turn {
        const turn = this.turn(turnId);
        turn.complete(answer, evidence);
        return turn;
    }

    public fail(turnId: string, error: unknown): Turn {
        const turn = this.turn(turnId);
        turn.fail(error);
        return turn;
    }

    public snapshots(): TurnSnapshot[] {
        return this.turns.map((turn) => turn.snapshot());
    }
}

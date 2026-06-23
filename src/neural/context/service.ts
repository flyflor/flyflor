import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { FService, Prompt, PromptService, Singleton } from '@/core';
import { ContextPrompt, ContextTurnStatus, type CompletedSummary, type ContextIntelligence, type ContextPause, type ContextSettleInput, type ContextTurn, type TurnUnderstanding } from './types';

@Singleton()
export class Context extends FService {
    public current?: TurnUnderstanding;

    public working: AgentMemory[] = [];

    public turns: ContextTurn[] = [];

    public completed: CompletedSummary[] = [];

    public pending?: ContextPause;

    public intelligence!: ContextIntelligence;

    @Prompt('prompts/context')
    public prompt!: PromptService<ContextPrompt>;

    public load(current: TurnUnderstanding): void {
        this.current = current;
        this.begin(current);
    }

    public work(entries: AgentMemory | AgentMemory[]): void {
        const normalized = Array.isArray(entries) ? entries : [entries];
        this.working.push(...normalized);
        const turn = this.activeTurn() ?? (this.current ? this.begin(this.current) : undefined);
        if (!turn) return;
        turn.transcript.push(...normalized);
        turn.updatedAt = Date.now();
    }

    public done(summary: CompletedSummary): void {
        this.completed.push(summary);
    }

    public pause(input: Omit<ContextPause, 'createdAt'>): ContextPause {
        const pending = { ...input, createdAt: Date.now() };
        this.pending = pending;
        const turn = this.activeTurn() ?? (this.current ? this.begin(this.current) : undefined);
        if (turn) {
            turn.status = ContextTurnStatus.Paused;
            turn.pending = pending;
            turn.updatedAt = pending.createdAt;
        }
        return pending;
    }

    public consumePending(): ContextPause | undefined {
        const pending = this.pending;
        if (!pending) return undefined;
        this.pending = undefined;
        const turn = this.turnForPending(pending) ?? this.activeTurn();
        if (turn) {
            turn.status = ContextTurnStatus.Working;
            turn.pending = undefined;
            turn.updatedAt = Date.now();
        }
        return pending;
    }

    public recent(limit = 4): ContextTurn[] {
        return this.turns.slice(-limit);
    }

    public async ingest(input: { content: string }): Promise<TurnUnderstanding> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Ingest]?.data ?? '') },
            { role: AgentChatRole.User, content: input.content },
        ]);
        const current = { ...(JSON.parse(raw) as Omit<TurnUnderstanding, 'userText'>), userText: input.content };
        this.current = current;
        if (this.pending) {
            this.resume(input.content, current);
        } else {
            this.begin(current);
        }
        return current;
    }

    public async settle(input: ContextSettleInput): Promise<CompletedSummary | undefined> {
        if (!input.completed) return undefined;
        const turn = this.activeTurn();
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Settle]?.data ?? '') },
            { role: AgentChatRole.User, content: JSON.stringify({ ...input, working: this.working, turn }) },
        ]);
        const summary = { ...(JSON.parse(raw) as Omit<CompletedSummary, 'createdAt'>), createdAt: Date.now() };
        this.completed.push(summary);
        if (turn) {
            turn.status = ContextTurnStatus.Completed;
            turn.updatedAt = summary.createdAt;
        }
        this.working = [];
        this.pending = undefined;
        return summary;
    }

    private begin(current: TurnUnderstanding): ContextTurn {
        const now = Date.now();
        const turn: ContextTurn = {
            id: `turn_${this.turns.length + 1}`,
            understanding: current,
            transcript: [{ role: AgentChatRole.User, content: current.userText }],
            status: ContextTurnStatus.Working,
            createdAt: now,
            updatedAt: now,
        };
        this.turns.push(turn);
        return turn;
    }

    private resume(content: string, understanding: TurnUnderstanding): void {
        if (!this.pending) return;
        const entry: AgentMemory = {
            role: AgentChatRole.User,
            content: JSON.stringify({
                user: content,
                pending: this.pending.kind,
                goal: understanding.goal,
                constraints: understanding.constraints,
            }),
        };
        this.pending.messages.push(entry);
        const turn = this.turnForPending(this.pending) ?? this.activeTurn();
        if (!turn) return;
        turn.understanding = understanding;
        turn.transcript.push(entry);
        turn.updatedAt = Date.now();
    }

    private activeTurn(): ContextTurn | undefined {
        return [...this.turns].reverse().find((turn) => turn.status !== ContextTurnStatus.Completed);
    }

    private turnForPending(pending: ContextPause): ContextTurn | undefined {
        return this.turns.find((turn) => turn.pending === pending);
    }
}

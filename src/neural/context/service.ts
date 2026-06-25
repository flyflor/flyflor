import { AgentChatRole } from '@/agent/types';
import { FService, Prompt, PromptService, Singleton } from '@/core';
import { ContextPrompt, ContextTurnStatus, type CompletedSummary, type ContextIntelligence, type ContextSettleInput, type ContextTurn, type TurnUnderstanding } from './types';

@Singleton()
/**
 * EN: Context class declaration.
 * ZH: Context class 声明。
 */
export class Context extends FService {
    public current?: TurnUnderstanding;

    public turns: ContextTurn[] = [];

    public completed: CompletedSummary[] = [];

    public intelligence!: ContextIntelligence;

    @Prompt('prompts/context')
    public prompt!: PromptService<ContextPrompt>;

    public load(current: TurnUnderstanding): void {
        this.current = current;
        this.begin(current);
    }

    public done(summary: CompletedSummary): void {
        this.completed.push(summary);
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
        this.begin(current);
        return current;
    }

    public async settle(input: ContextSettleInput): Promise<CompletedSummary | undefined> {
        if (!input.completed) return undefined;
        const turn = this.activeTurn();
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Settle]?.data ?? '') },
            {
                role: AgentChatRole.User,
                content: JSON.stringify({
                    ...input,
                    current: this.current,
                    recent: this.recent(),
                }),
            },
        ]);
        const summary = { ...(JSON.parse(raw) as Omit<CompletedSummary, 'createdAt'>), createdAt: Date.now() };
        this.completed.push(summary);
        if (turn) {
            turn.status = ContextTurnStatus.Completed;
            turn.summary = summary;
            turn.updatedAt = summary.createdAt;
        }
        return summary;
    }

    private begin(current: TurnUnderstanding): ContextTurn {
        const now = Date.now();
        const turn: ContextTurn = {
            id: `turn_${this.turns.length + 1}`,
            understanding: current,
            status: ContextTurnStatus.Working,
            createdAt: now,
            updatedAt: now,
        };
        this.turns.push(turn);
        return turn;
    }

    private activeTurn(): ContextTurn | undefined {
        return [...this.turns].reverse().find((turn) => turn.status !== ContextTurnStatus.Completed);
    }
}

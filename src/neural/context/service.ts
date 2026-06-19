import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { FService, Prompt, PromptService, Singleton } from '@/core';
import { ContextPrompt, type CompletedSummary, type ContextIntelligence, type ContextSettleInput, type TurnUnderstanding } from './types';

@Singleton()
export class Context extends FService {
    public current?: TurnUnderstanding;

    public working: AgentMemory[] = [];

    public completed: CompletedSummary[] = [];

    public pending?: unknown;

    public intelligence!: ContextIntelligence;

    @Prompt('prompts/context')
    public prompt!: PromptService<ContextPrompt>;

    public load(current: TurnUnderstanding): void {
        this.current = current;
    }

    public work(entries: AgentMemory | AgentMemory[]): void {
        this.working.push(...(Array.isArray(entries) ? entries : [entries]));
    }

    public done(summary: CompletedSummary): void {
        this.completed.push(summary);
    }

    public async ingest(input: { content: string }): Promise<TurnUnderstanding> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Ingest]?.data ?? '') },
            { role: AgentChatRole.User, content: input.content },
        ]);
        const current = { ...(JSON.parse(raw) as Omit<TurnUnderstanding, 'userText'>), userText: input.content };
        this.current = current;
        return current;
    }

    public async settle(input: ContextSettleInput): Promise<CompletedSummary | undefined> {
        if (!input.completed) return undefined;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Settle]?.data ?? '') },
            { role: AgentChatRole.User, content: JSON.stringify({ ...input, working: this.working }) },
        ]);
        const summary = { ...(JSON.parse(raw) as Omit<CompletedSummary, 'createdAt'>), createdAt: Date.now() };
        this.completed.push(summary);
        this.working = [];
        this.pending = undefined;
        return summary;
    }
}

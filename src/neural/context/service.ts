import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentChatRole } from '@/agent/types';
import { FService, Prompt, PromptService, Singleton } from '@/core';
import { ContextPrompt, ContextTurnStatus, type CompletedSummary, type ContextIntelligence, type ContextPauseInput, type ContextSettleInput, type ContextTurn, type TurnUnderstanding } from './types';

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
        this.writeSnapshot();
    }

    public done(summary: CompletedSummary): void {
        this.completed.push(summary);
        this.writeSnapshot();
    }

    public recent(limit = 4): ContextTurn[] {
        return this.turns.slice(-limit);
    }

    public async ingest(input: { content: string }): Promise<TurnUnderstanding> {
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[ContextPrompt.Ingest]?.data ?? '') },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input.content, current: this.current, recent: this.recent() }) },
        ]);
        const current = { ...(this.json<Omit<TurnUnderstanding, 'userText'>>(raw)), userText: input.content };
        const paused = this.activeTurn();
        if (paused) this.resume(paused);
        this.current = current;
        this.begin(current);
        this.writeSnapshot();
        return current;
    }

    public pause(input: ContextPauseInput): void {
        const turn = this.activeTurn();
        if (!turn) return;
        turn.paused = true;
        turn.pauseKind = input.kind;
        turn.pausePrompt = input.prompt;
        turn.updatedAt = Date.now();
        this.writeSnapshot();
    }

    public resume(turn = this.activeTurn()): void {
        if (!turn) return;
        turn.paused = false;
        turn.pauseKind = undefined;
        turn.pausePrompt = undefined;
        turn.updatedAt = Date.now();
        this.writeSnapshot();
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
        const summary = { ...(this.json<Omit<CompletedSummary, 'createdAt'>>(raw)), createdAt: Date.now() };
        this.completed.push(summary);
        if (turn) {
            turn.status = ContextTurnStatus.Completed;
            turn.summary = summary;
            turn.assistantText = input.assistant;
            turn.paused = false;
            turn.pauseKind = undefined;
            turn.pausePrompt = undefined;
            turn.updatedAt = summary.createdAt;
        }
        this.writeSnapshot();
        return summary;
    }

    private json<T>(raw: string): T {
        const trimmed = raw.trim();
        try {
            return JSON.parse(trimmed) as T;
        } catch {
            const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            if (fenced !== trimmed) {
                try {
                    return JSON.parse(fenced) as T;
                } catch {
                    // fall through to object extraction below
                }
            }
            const start = trimmed.indexOf('{');
            const end = trimmed.lastIndexOf('}');
            if (start >= 0 && end > start) {
                return JSON.parse(trimmed.slice(start, end + 1)) as T;
            }
            throw new SyntaxError(`Invalid JSON from model: ${raw}`);
        }
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
        const turn = this.turns.at(-1);
        return turn?.status === ContextTurnStatus.Completed ? undefined : turn;
    }

    private writeSnapshot(): void {
        const lines = [
            '# Context Cache',
            '',
            'Derived debug view only. Source of truth is Context.turns in memory.',
            '',
            `updatedAt: ${new Date().toISOString()}`,
            '',
            '## Current',
            '',
            this.current ? this.turn(this.turns.at(-1)) : 'none',
            '',
            '## Recent',
            '',
            ...this.recent().map((turn) => this.turn(turn)),
            '',
        ];
        writeFileSync(join(process.cwd(), 'cache.context.md'), lines.join('\n'), 'utf8');
    }

    private turn(turn: ContextTurn | undefined): string {
        if (turn === undefined) return 'none';
        const payload = {
            id: turn.id,
            status: turn.status,
            paused: turn.paused ?? false,
            pauseKind: turn.pauseKind,
            pausePrompt: turn.pausePrompt,
            user: turn.understanding.userText,
            goal: turn.understanding.goal,
            workingDirectory: turn.understanding.workingDirectory,
            assistant: turn.assistantText,
            summary: turn.summary ? {
                result: turn.summary.result,
                decisions: turn.summary.decisions,
                evidence: turn.summary.evidence,
                remaining: turn.summary.remaining,
            } : undefined,
        };
        return `\`\`\`json\n${JSON.stringify(payload, undefined, 2)}\n\`\`\``;
    }
}

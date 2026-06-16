import { AgentChatRole, type AgentMemory, type AgentTurnInput, type Memory } from '@/agent/memory';
import { FService, Inject, Logger, Singleton, type FLogger } from '@/core';
import { Intelligence } from '@/agent/brain/intelligence/service';
import { ContextIntent, type CompletedSummary, type ContextSettleInput, type TurnUnderstanding } from './types';

const UNDERSTAND_PROMPT = [
    'Distill this user turn into agent working memory before routing.',
    'Return JSON only: {"intent":"reply|research|soul","goal":"string","constraints":["string"],"requestedOutput":"string","references":[{"type":"path|error|command|symbol|text","value":"string"}],"knownDone":["string"],"openQuestions":["string"],"shouldInvestigate":boolean}',
].join('\n');

const SETTLE_PROMPT = [
    'Summarize one completed agent turn into completed working-memory state.',
    'Return JSON only: {"goal":"string","result":"string","changedFiles":["string"],"decisions":["string"],"evidence":["string"],"remaining":["string"]}',
].join('\n');

@Singleton()
export class Context extends FService {
    @Logger(Context.name)
    public readonly log!: FLogger;

    @Inject()
    public intelligence!: Intelligence;

    public async ingest(memory: Memory, input: AgentTurnInput): Promise<TurnUnderstanding> {
        const understanding = await this.askUnderstanding(memory, input);
        memory.load(understanding);
        return understanding;
    }

    public async settle(memory: Memory, input: ContextSettleInput): Promise<CompletedSummary | undefined> {
        if (!input.completed) return undefined;
        const summary = await this.askCompletion(memory, input);
        memory.rememberCompletion(summary);
        return summary;
    }

    private async askUnderstanding(memory: Memory, input: AgentTurnInput): Promise<TurnUnderstanding> {
        try {
            const response = await this.intelligence.completeText([
                { role: AgentChatRole.System, content: UNDERSTAND_PROMPT },
                { role: AgentChatRole.User, content: JSON.stringify({ user: input.content, completed: memory.completed.slice(-6), working: memory.working.slice(-8) }) },
            ]);
            return this.toUnderstanding(this.json(response), input.content);
        } catch (error) {
            this.log.warn('context.ingest.fallback', error instanceof Error ? error.message : String(error));
            return this.fallbackUnderstanding(input.content);
        }
    }

    private async askCompletion(memory: Memory, input: ContextSettleInput): Promise<CompletedSummary> {
        try {
            const response = await this.intelligence.completeText([
                { role: AgentChatRole.System, content: SETTLE_PROMPT },
                { role: AgentChatRole.User, content: JSON.stringify({ current: memory.current, working: input.working.slice(-8), answer: input.assistant }) },
            ]);
            return this.toCompletion(this.json(response), this.fallbackCompletion(memory, input));
        } catch (error) {
            this.log.warn('context.settle.fallback', error instanceof Error ? error.message : String(error));
            return this.fallbackCompletion(memory, input);
        }
    }

    private toUnderstanding(value: Record<string, unknown>, userText: string): TurnUnderstanding {
        const intent = value.intent === ContextIntent.Soul
            ? ContextIntent.Soul
            : value.intent === ContextIntent.Research
                ? ContextIntent.Research
                : ContextIntent.Reply;
        return {
            userText,
            intent,
            goal: this.text(value.goal) || this.cut(userText, 1000),
            constraints: this.list(value.constraints),
            requestedOutput: this.text(value.requestedOutput) || undefined,
            references: Array.isArray(value.references) ? value.references.flatMap((item) => this.reference(item)) : [],
            knownDone: this.list(value.knownDone),
            openQuestions: this.list(value.openQuestions),
            shouldInvestigate: typeof value.shouldInvestigate === 'boolean' ? value.shouldInvestigate : intent === ContextIntent.Research,
        };
    }

    private toCompletion(value: Record<string, unknown>, fallback: CompletedSummary): CompletedSummary {
        return {
            goal: this.text(value.goal) || fallback.goal,
            result: this.text(value.result) || fallback.result,
            changedFiles: this.list(value.changedFiles),
            decisions: this.list(value.decisions),
            evidence: this.list(value.evidence),
            remaining: this.list(value.remaining),
            createdAt: Date.now(),
        };
    }

    private fallbackUnderstanding(userText: string): TurnUnderstanding {
        const intent = /灵魂|soul|画像|人设|personality/i.test(userText)
            ? ContextIntent.Soul
            : /研究|调查|debug|报错|错误|修复|实现|修改|implement|fix|error|test|文件|项目|代码/i.test(userText)
                ? ContextIntent.Research
                : ContextIntent.Reply;
        return {
            userText,
            intent,
            goal: this.cut(userText.trim(), 1000),
            constraints: [],
            references: [],
            knownDone: [],
            openQuestions: [],
            shouldInvestigate: intent === ContextIntent.Research,
        };
    }

    private fallbackCompletion(memory: Memory, input: ContextSettleInput): CompletedSummary {
        return {
            goal: memory.current?.goal ?? this.cut(input.user, 1000),
            result: this.cut(input.assistant.trim(), 1600),
            changedFiles: [],
            decisions: memory.current?.constraints ?? [],
            evidence: input.working.slice(-6).map((message) => this.cut(`${message.role}: ${message.content}`, 500)),
            remaining: memory.current?.openQuestions ?? [],
            createdAt: Date.now(),
        };
    }

    private json(text: string): Record<string, unknown> {
        const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw Error('Context JSON must be an object');
        return parsed as Record<string, unknown>;
    }

    private reference(value: unknown): TurnUnderstanding['references'] {
        if (typeof value !== 'object' || value === null) return [];
        const type = (value as { type?: unknown }).type;
        const text = this.text((value as { value?: unknown }).value);
        if (text.length === 0) return [];
        return [{ type: type === 'path' || type === 'error' || type === 'command' || type === 'symbol' ? type : 'text', value: text }];
    }

    private list(value: unknown): string[] {
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8).map((item) => this.cut(item.trim(), 800)) : [];
    }

    private text(value: unknown): string {
        return typeof value === 'string' ? this.cut(value.trim(), 4000) : '';
    }

    private cut(text: string, max: number): string {
        return text.length <= max ? text : `${text.slice(0, max)}...`;
    }
}

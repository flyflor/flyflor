import { FAgentAtom, Inject, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import { Context } from '@/neural/context';

export enum SoulSection {
    /** Agent identity / constitution layer. Loaded from `SOUL.md`. */
    Soul = 'SOUL',

    /** User profile (画像). Loaded from `USER.md`. */
    User = 'USER',

    /** Fixed protocol-package constitution. Loaded from `AGENTS.md`. */
    Agents = 'AGENTS',

    /** Agent extension/capability summary. Loaded from `EXTENSION.md`. */
    Extension = 'EXTENSION',
}

/**
 * Roles accepted by provider chat protocols.
 * These values are provider protocol strings, not Flyflor context section names.
 */
export enum AgentChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
}

/**
 * One pure short-term memory message for an Agent.
 *
 * AgentMemory is the reusable agent-facing cache surface. It must not carry tool/action requests,
 * provider replay messages, turn transcripts, or pending state.
 */
export interface AgentMemory {
    role: AgentChatRole.System | AgentChatRole.User | AgentChatRole.Assistant;
    content: string;
}

@Provide()
export class Memory extends FAgentAtom {
    @Prompt(function (this: Memory) {
        return `.config/agents/${this.agentConfig.name}`;
    })
    public prompt!: PromptService<SoulSection> & PromptPackageData<SoulSection>;

    @Inject()
    public context!: Context;

    public buildMessage(): AgentMemory[] {
        const system = [
            ...this.sections(),
            this.memory(),
        ].filter((text) => text.trim().length > 0).join('\n\n');
        const messages: AgentMemory[] = system.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content: system }];
        if (this.context.current) {
            messages.push({
                role: AgentChatRole.User,
                content: JSON.stringify(this.contextBlock()),
            });
        }
        return messages;
    }

    private sections(): string[] {
        const ignored = new Set(this.prompt.config?.protocolPackage.runtimeIgnored ?? []);
        return (this.prompt.config?.prompt.sections ?? [])
            .map((section) => {
                const block = this.prompt.config?.protocolPackage.context.blocks.find((item) => item.key === section);
                if (block && ignored.has(block.file)) return '';
                return String((this.prompt.data as PromptPackageData<string>)[section]?.data ?? '').trim();
            });
    }

    private memory(): string {
        const current = this.context.current ? `<current>${this.context.current.goal}</current>` : '';
        const completed = this.context.completed.map((summary) => `<completed>${JSON.stringify({
            goal: summary.goal,
            result: summary.result,
            decisions: summary.decisions,
            evidence: summary.evidence,
            remaining: summary.remaining,
        })}</completed>`).join('\n');
        return `<agent_memory>\n${[current, completed].filter(Boolean).join('\n')}\n</agent_memory>`;
    }

    private contextBlock(): object {
        return {
            current: this.context.current ? {
                goal: this.context.current.goal,
                user: this.context.current.userText,
                intent: this.context.current.intent,
                constraints: this.context.current.constraints,
                references: this.context.current.references,
                knownDone: this.context.current.knownDone,
                openQuestions: this.context.current.openQuestions,
                shouldInvestigate: this.context.current.shouldInvestigate,
            } : undefined,
            recentTurns: this.context.recent().map((turn) => ({
                status: turn.status,
                goal: turn.understanding.goal,
                user: turn.understanding.userText,
                summary: turn.summary ? {
                    result: turn.summary.result,
                    decisions: turn.summary.decisions,
                    evidence: turn.summary.evidence,
                    remaining: turn.summary.remaining,
                } : undefined,
            })),
            completed: this.context.completed.map((summary) => ({
                goal: summary.goal,
                result: summary.result,
                decisions: summary.decisions,
                evidence: summary.evidence,
                remaining: summary.remaining,
            })),
        };
    }
}

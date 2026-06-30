import { FAgentAtom, Inject, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import { Context } from '@/neural/context';
import { AgentChatRole, type AgentMemory } from './types';

export { AgentChatRole, type AgentMemory } from './types';

export enum SoulSection {
    /** EN: Agent identity / constitution layer loaded from `SOUL.md`. ZH: 来自 `SOUL.md` 的智能体身份/人格层。 */
    Soul = 'SOUL',

    /** EN: User profile loaded from `USER.md`. ZH: 来自 `USER.md` 的用户画像。 */
    User = 'USER',

    /** EN: Fixed protocol-package constitution loaded from `AGENTS.md`. ZH: 来自 `AGENTS.md` 的固定协议包宪法。 */
    Agents = 'AGENTS',

    /** EN: Agent extension/capability summary loaded from `EXTENSION.md`. ZH: 来自 `EXTENSION.md` 的扩展/能力摘要。 */
    Extension = 'EXTENSION',
}

/**
 * EN: Memory owns prompt assembly and pure short-term memory projection.
 * ZH: Memory 负责 prompt 组装和纯短期记忆投影。
 */
@Provide()
export class Memory extends FAgentAtom {
    @Prompt((prop: Memory) => `.config/agents/${prop.agentConfig.name}`)
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
        const active = this.context.recent(1).at(-1);
        return {
            current: this.context.current ? {
                goal: this.context.current.goal,
                user: this.context.current.userText,
                intent: this.context.current.intent,
                workingDirectory: this.context.current.workingDirectory,
                constraints: this.context.current.constraints,
                references: this.context.current.references,
                knownDone: this.context.current.knownDone,
                openQuestions: this.context.current.openQuestions,
                shouldInvestigate: this.context.current.shouldInvestigate,
                paused: active?.paused ?? false,
                pauseKind: active?.pauseKind,
                pausePrompt: active?.pausePrompt,
            } : undefined,
            recentContext: this.context.recent().map((entry) => ({
                status: entry.status,
                goal: entry.understanding.goal,
                user: entry.understanding.userText,
                assistantText: entry.assistantText,
                paused: entry.paused ?? false,
                pauseKind: entry.pauseKind,
                pausePrompt: entry.pausePrompt,
                summary: entry.summary ? {
                    result: entry.summary.result,
                    decisions: entry.summary.decisions,
                    evidence: entry.summary.evidence,
                    remaining: entry.summary.remaining,
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

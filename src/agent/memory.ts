import { FAgentAtom, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import type { AgentBrief, MemoryNote } from '@/agent/context/types';
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
 * EN: Private memory cache owned by one agent. It is limited, independent, and
 * not a transcript of the conversation. The agent keeps only the notes it needs
 * to understand the current user intent.
 * ZH: 单个 agent 私有的记忆缓存。它有限、独立，不是对话副本。agent 只保留理解
 * 当前用户意图所需的笔记。
 */
@Provide()
export class Memory extends FAgentAtom {
    @Prompt((prop: Memory) => `.config/agents/${prop.agentConfig.name}`)
    public prompt!: PromptService<SoulSection> & PromptPackageData<SoulSection>;

    /** EN: Max number of notes this agent can hold. ZH: 该 agent 可持有的最大笔记数。 */
    public capacity = 16;

    /** EN: Private notes kept by this agent. ZH: 该 agent 保留的私有笔记。 */
    public notes: MemoryNote[] = [];

    /** EN: Seeds the memory cache with the Context brief for the current task. ZH: 用当前任务的 Context 简报初始化记忆缓存。 */
    public ingestBrief(brief: AgentBrief): void {
        this.notes = [];
        this.remember(
            `turn ${brief.turnId}: intent=${brief.intent}, goal=${brief.goal}, constraints=[${brief.constraints.join('; ')}]`,
            'brief',
        );
        for (const ref of brief.refs) {
            this.remember(`${ref.type}: ${ref.value}`, 'brief');
        }
    }

    /** EN: Adds one note to the agent's private cache, dropping oldest notes when over capacity. ZH: 向 agent 私有缓存添加一条笔记，超出容量时丢弃最旧的笔记。 */
    public remember(content: string, source: MemoryNote['source']): void {
        this.notes.push({ id: `note_${this.notes.length + 1}`, content, source, ts: Date.now() });
        if (this.notes.length > this.capacity) {
            this.notes = this.notes.slice(-this.capacity);
        }
    }

    public buildMessage(): AgentMemory[] {
        const system = this.prompt.render({ kind: 'sections' });
        const messages: AgentMemory[] = system.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content: system }];
        if (this.notes.length > 0) {
            messages.push({
                role: AgentChatRole.User,
                content: this.notes.map((note) => `-[${note.source}] ${note.content}`).join('\n'),
            });
        }
        return messages;
    }
}
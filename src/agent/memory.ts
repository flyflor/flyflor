import { FAgentAtom, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import type { AgentBrief, MemoryNote } from '@/agent/context/types';
import { AgentChatRole, type AgentMemory } from './types';

export { AgentChatRole, type AgentMemory } from './types';

export enum SoulSection {
    /** EN: Static agent identity / constitution loaded from `SOUL.md`. ZH: 来自 `SOUL.md` 的静态智能体身份/人格层。 */
    Soul = 'SOUL',

    /** EN: Legacy user-profile placeholder; never loaded by the active runtime. ZH: 用户画像占位；活跃运行时永不加载。 */
    User = 'USER',

    /** EN: Fixed protocol-package constitution loaded from `AGENTS.md`. ZH: 来自 `AGENTS.md` 的固定协议包宪法。 */
    Agents = 'AGENTS',

    /** EN: Static agent extension/capability summary loaded from `EXTENSION.md`. ZH: 来自 `EXTENSION.md` 的静态扩展/能力摘要。 */
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
    @Prompt((prop: Memory) => prop.agentConfig.promptPackage ?? `.config/agents/${prop.agentConfig.name}`)
    public prompt!: PromptService<string> & PromptPackageData<string>;

    /** EN: Max number of notes this agent can hold. ZH: 该 agent 可持有的最大笔记数。 */
    public capacity = 16;

    /** EN: Private notes kept by this agent. ZH: 该 agent 保留的私有笔记。 */
    public notes: MemoryNote[] = [];

    private noteSequence = 0;

    /** EN: Seeds the memory cache with the Context brief for the current task. ZH: 用当前任务的 Context 简报初始化记忆缓存。 */
    public ingestBrief(brief: AgentBrief): void {
        this.notes = [];
        this.remember(
            `turn ${brief.turnId}: intent=${brief.intent}, goal=${brief.goal}, constraints=[${brief.constraints.join('; ')}]`,
            'brief',
        );
        if (brief.done?.length > 0) this.remember(`done: ${brief.done.join('; ')}`, 'brief');
        if (brief.open?.length > 0) this.remember(`open: ${brief.open.join('; ')}`, 'brief');
        if (brief.persona) this.remember(`persona: ${brief.persona}`, 'brief');
        for (const ref of brief.refs) {
            this.remember(`${ref.type}: ${ref.value}`, 'brief');
        }
        for (const turn of brief.workspace ?? []) {
            if (turn.turnId === brief.turnId || turn.outcome === undefined) continue;
            this.remember(`workspace ${turn.turnId}: ${turn.goal} -> ${turn.outcome.result}`, 'brief');
        }
    }

    /** EN: Adds one note to the agent's private cache, dropping oldest notes when over capacity. ZH: 向 agent 私有缓存添加一条笔记，超出容量时丢弃最旧的笔记。 */
    public remember(content: string, source: MemoryNote['source']): void {
        this.noteSequence += 1;
        this.notes.push({ id: `note_${this.noteSequence}`, content: content.slice(0, 1024), source, ts: Date.now() });
        if (this.notes.length > this.capacity) {
            this.notes = this.notes.slice(-this.capacity);
        }
    }

    public buildMessage(): AgentMemory[] {
        const sections = this.agentConfig.promptSections?.filter((section) => section !== SoulSection.User)
            ?? [SoulSection.Soul, SoulSection.Extension];
        const system = this.prompt.render({ kind: 'sections', sections });
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

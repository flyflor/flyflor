import type { AgentContext } from '@/collective/context';
import type { ConfigService } from '@/configuration';
import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { Config, FAgent, Prompt, PromptService, Provide } from '@/core';
import type { MemoryNote, MemoryNoteSource } from './types';

const MAX_MEMORY_NOTE_CHARS = 4000;

/**
 * EN: One fixed agent's volatile local working memory. It never owns dialogue history.
 * ZH: 固定 Agent 的易失局部工作记忆；它永远不拥有对话历史。
 */
@Provide()
export class Memory extends FAgent {
    @Config()
    public config!: ConfigService;

    @Prompt((memory: Memory) => memory.agentConfig.promptPackage ?? `./prompts/agents/${memory.agentConfig.name}`)
    public prompt!: PromptService;

    private sequence = 0;
    private readonly notes: MemoryNote[] = [];

    public remember(content: string, source: MemoryNoteSource, salience = 0.6): void {
        const sourceText = content.trim();
        if (!sourceText) return;
        const normalized = sourceText.length <= MAX_MEMORY_NOTE_CHARS
            ? sourceText
            : `${sourceText.slice(0, MAX_MEMORY_NOTE_CHARS - 3)}...`;
        this.sequence += 1;
        const now = Date.now();
        this.notes.push({
            id: `${this.agentConfig.name}_note_${this.sequence}`,
            content: normalized,
            source,
            salience: Math.max(0, Math.min(1, salience)),
            createdAt: now,
            lastAccessedAt: now,
        });
        this.notes.sort((left, right) => right.salience - left.salience || right.lastAccessedAt - left.lastAccessedAt);
        this.notes.splice(this.config.collective.agentNoteLimit);
    }

    public snapshot(): MemoryNote[] {
        const now = Date.now();
        for (const note of this.notes) note.lastAccessedAt = now;
        return structuredClone(this.notes);
    }

    public messages(context: AgentContext): AgentMemory[] {
        const system = this.prompt.render({ kind: 'sections', sections: this.agentConfig.promptSections });
        const messages: AgentMemory[] = system.trim()
            ? [{ role: AgentChatRole.System, content: system }]
            : [];
        messages.push({
            role: AgentChatRole.User,
            content: JSON.stringify({
                focus: context.focus,
                history: context.history,
                globalWorkspace: context.items,
                localMemory: context.localMemory,
            }),
        });
        return messages;
    }
}

import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Prompt, Provide } from '@/core';
import { PromptService } from '@/prompt';
import type { ContextBrief } from '@/agent/context';
import { AgentChatRole, type AgentBus, type AgentMemory, type AgentTask } from '@/agent/types';

/** EN: Origin of one finite Agent memory note. ZH: 一条有限 Agent 记忆笔记的来源。 */
export type MemorySource = 'brief' | 'observation';

/** EN: One bounded note retained by one Agent. ZH: 一个 Agent 保留的一条有界笔记。 */
export interface MemoryNote {
    id: string;
    source: MemorySource;
    content: string;
    createdAt: number;
}

/**
 * EN: Finite continuous short-term memory owned by exactly one Agent scope.
 * ZH: 由唯一 Agent scope 持有的有限连续短期记忆。
 */
@Provide()
export class Memory extends FComponent {
    @Prompt('prompts/memory')
    public prompt!: PromptService;

    private sequence: number;
    private readonly capacity: number;
    private notes: MemoryNote[];

    /**
     * EN: Binds this Memory to one Agent identity and its cortical bus.
     * ZH: 将当前 Memory 绑定到一个 Agent 身份及其皮层总线。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
        this.sequence = 0;
        this.capacity = 16;
        this.notes = [];
    }

    /**
     * EN: Remembers one root Context brief without taking ownership of its Turn.
     * ZH: 记住一个根 Context brief，但不取得其 Turn 所有权。
     */
    public observe(brief: ContextBrief): void {
        const references = brief.references.map((reference) => `${reference.type}:${reference.value}`).join('; ');
        this.remember(`goal=${brief.goal}; constraints=${brief.constraints.join('; ')}; references=${references}`, 'brief');
    }

    /**
     * EN: Remembers one cortical task assigned to this Agent.
     * ZH: 记住一项由皮层分配给当前 Agent 的任务。
     */
    public assign(task: AgentTask): void {
        this.remember(`task=${task.goal}; parent=${task.context.goal}`, 'brief');
    }

    /**
     * EN: Adds one note and evicts the oldest note past finite capacity.
     * ZH: 添加一条笔记，并在超过有限容量时淘汰最旧笔记。
     */
    public remember(content: string, source: MemorySource): void {
        if (content.length === 0) throw Error('Memory note is empty');
        this.sequence += 1;
        this.notes.push({ id: `note_${this.sequence}`, source, content, createdAt: Date.now() });
        if (this.notes.length > this.capacity) this.notes = this.notes.slice(-this.capacity);
    }

    /**
     * EN: Projects finite notes into one model-bound XML memory message.
     * ZH: 将有限笔记投影为一条面向模型的 XML memory 消息。
     */
    public messages(): AgentMemory[] {
        if (this.notes.length === 0) return [];
        return [{
            role: AgentChatRole.User,
            content: this.prompt.render({
                kind: 'document',
                root: 'agent_memory',
                attributes: { agent: this.agentConfig.name },
                blocks: this.notes.map((note) => ({
                    tag: 'note',
                    content: note.content,
                    attributes: { id: note.id, source: note.source },
                })),
            }),
        }];
    }

    /**
     * EN: Returns immutable notes for diagnostics and focused tests.
     * ZH: 返回用于诊断和聚焦测试的不可变笔记。
     */
    public snapshot(): MemoryNote[] {
        return this.notes.map((note) => ({ ...note }));
    }
}

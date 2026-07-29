import { Config, FNeuron, Prompt, PromptService, Provide, type FSynapseBus, type PromptPackageData } from '@/core';
import type { ConfigService } from '@/configuration';
import type { ContextBrief, MemoryNote } from '@/neural/context/types';
import { ChatRole, type MemoryMessage } from './types';

export { ChatRole, type MemoryMessage } from './types';

export enum SoulSection {
    /** EN: Static identity / constitution of the mind loaded from `SOUL.md`. ZH: 来自 `SOUL.md` 的静态心智身份/人格层。 */
    Soul = 'SOUL',

    /** EN: Legacy user-profile placeholder; never loaded by the active runtime. ZH: 用户画像占位；活跃运行时永不加载。 */
    User = 'USER',

    /** EN: Fixed protocol-package constitution loaded from `AGENTS.md`. ZH: 来自 `AGENTS.md` 的固定协议包宪法。 */
    Agents = 'AGENTS',

    /** EN: Static capability/extension summary of the mind loaded from `EXTENSION.md`. ZH: 来自 `EXTENSION.md` 的静态扩展/能力摘要。 */
    Extension = 'EXTENSION',
}

/**
 * EN: Private working-memory cache owned by one thought thread. It is limited,
 * independent, and not a transcript of the conversation. The mind keeps only
 * the notes it needs to understand the current user intent.
 * ZH: 单个思维线程私有的工作记忆缓存。它有限、独立，不是对话副本。心智只保留
 * 理解当前用户意图所需的笔记。
 */
@Provide()
export class Memory extends FNeuron {
    @Config()
    /** EN: Root configuration service; injected before `@Prompt` so the persona package path is available. ZH: 根配置服务；先于 `@Prompt` 注入，保证 persona 包路径可用。 */
    public config!: ConfigService;

    @Prompt((prop: Memory) => prop.config.persona.promptPackage ?? './prompts/agent')
    /** EN: Prompt package holding the persona sections. ZH: 持有人格 section 的提示词包。 */
    public prompt!: PromptService<string> & PromptPackageData<string>;

    /** EN: Max number of notes this cache can hold. ZH: 该缓存可持有的最大笔记数。 */
    public capacity: number;

    /** EN: Private notes kept by this thought thread. ZH: 该思维线程保留的私有笔记。 */
    public notes: MemoryNote[];

    private noteSequence: number;

    constructor(synapse: FSynapseBus | undefined = undefined) {
        super(synapse as FSynapseBus);
        this.capacity = 16;
        this.notes = [];
        this.noteSequence = 0;
    }

    /** EN: Seeds the memory cache with the Context brief for the current task. ZH: 用当前任务的 Context 简报初始化记忆缓存。 */
    public ingestBrief(brief: ContextBrief): void {
        this.notes = [];
        this.remember(
            `turn ${brief.turnId}: intent=${brief.intent}, goal=${brief.goal}, constraints=[${brief.constraints.join('; ')}]`,
            'brief',
        );
        if (brief.done?.length > 0) this.remember(`done: ${brief.done.join('; ')}`, 'brief');
        if (brief.open?.length > 0) this.remember(`open: ${brief.open.join('; ')}`, 'brief');
        for (const ref of brief.refs) {
            this.remember(`${ref.type}: ${ref.value}`, 'brief');
        }
        for (const turn of brief.workspace ?? []) {
            if (turn.turnId === brief.turnId || turn.outcome === undefined) continue;
            this.remember(`workspace ${turn.turnId}: ${turn.goal} -> ${turn.outcome.result}`, 'brief');
        }
    }

    /** EN: Adds one note to the private cache, dropping oldest notes when over capacity. ZH: 向私有缓存添加一条笔记，超出容量时丢弃最旧的笔记。 */
    public remember(content: string, source: MemoryNote['source']): void {
        this.noteSequence += 1;
        this.notes.push({ id: `note_${this.noteSequence}`, content: content.slice(0, 1024), source, ts: Date.now() });
        if (this.notes.length > this.capacity) {
            this.notes = this.notes.slice(-this.capacity);
        }
    }

    /** EN: Builds the provider message list from persona prompt sections and cached notes. ZH: 由人格提示词 section 与缓存笔记构建发往 provider 的消息列表。 */
    public buildMessage(): MemoryMessage[] {
        const sections = this.config.persona.promptSections?.filter((section) => section !== SoulSection.User)
            ?? [SoulSection.Soul, SoulSection.Extension];
        const system = this.prompt.render({ kind: 'sections', sections });
        const messages: MemoryMessage[] = system.trim().length === 0 ? [] : [{ role: ChatRole.System, content: system }];
        if (this.notes.length > 0) {
            messages.push({
                role: ChatRole.User,
                content: this.notes.map((note) => `-[${note.source}] ${note.content}`).join('\n'),
            });
        }
        return messages;
    }
}

import { Config, FNeuron, Prompt, PromptService, Provide, type FCortexBus, type PromptPackageData } from '@/core';
import type { ConfigService } from '@/configuration';
import { AgentProfile } from '@/population/types';
import type { TurnBrief, TurnOutcome, WorkspaceBrief, ScratchNote } from '@/neural/workspace/types';
import { ChatRole, type MindMessage } from './types';

export { ChatRole, type MindMessage } from './types';

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
 * EN: Private scratchpad owned by one thought thread. It is limited,
 * independent, and not a transcript of the conversation. The mind keeps only
 * the notes it needs to understand the current user intent. Notes are
 * temporary working-set material, never a long-term memory write path.
 * ZH: 单个思维线程私有的临时笔记缓存。它有限、独立，不是对话副本。心智只保留
 * 理解当前用户意图所需的笔记。笔记是临时工作集材料，绝不是长期记忆写路径。
 */
@Provide()
export class Scratchpad extends FNeuron {
    /** EN: Max situation-buffer lines seeded from one brief. ZH: 单次简报最多播种的情境缓冲行数。 */
    public static readonly SituationSeedLimit = 4;
    /** EN: Max peer-turn outcome lines seeded from one brief. ZH: 单次简报最多播种的其他 turn outcome 行数。 */
    public static readonly PeerOutcomeSeedLimit = 4;
    /** EN: Max list items quoted from one outcome field. ZH: 单条 outcome 字段最多引用的列表项数。 */
    public static readonly OutcomeListSeedLimit = 4;

    @Config()
    /** EN: Root configuration service; injected before `@Prompt` so the persona package path is available. ZH: 根配置服务；先于 `@Prompt` 注入，保证 persona 包路径可用。 */
    public config!: ConfigService;

    @Prompt((prop: Scratchpad) => prop.profile?.personaPackage ?? prop.config.persona.promptPackage ?? './prompts/agent')
    /** EN: Prompt package holding the persona sections. ZH: 持有人格 section 的提示词包。 */
    public prompt!: PromptService<string> & PromptPackageData<string>;

    /** EN: Max number of notes this cache can hold. ZH: 该缓存可持有的最大笔记数。 */
    public capacity: number;

    /** EN: Private notes kept by this thought thread. ZH: 该思维线程保留的私有笔记。 */
    public notes: ScratchNote[];

    private noteSequence: number;

    constructor(cortex: FCortexBus | undefined = undefined, public profile?: AgentProfile) {
        super(cortex as FCortexBus);
        this.capacity = 16;
        this.notes = [];
        this.noteSequence = 0;
    }

    /**
     * EN: Seeds the scratchpad from a Workspace brief for the current task.
     * Includes lifecycle status, salvage outcome for suspended turns, a bounded
     * situation buffer projection, and peer workspace outcomes — never a transcript.
     * ZH: 用当前任务的 Workspace 简报初始化临时笔记。包含生命周期状态、挂起 turn
     * 的可挽救 outcome、有界情境缓冲投影与其他工作集 outcome——从不写入 transcript。
     */
    public ingestBrief(brief: WorkspaceBrief): void {
        this.notes = [];
        const current = brief.workspace?.find((turn) => turn.turnId === brief.turnId);
        const status = current?.status;
        this.remember(
            `turn ${brief.turnId}: status=${status ?? 'unknown'}, intent=${brief.intent}, goal=${brief.goal}, constraints=[${brief.constraints.join('; ')}]`,
            'brief',
        );
        if (brief.done?.length > 0) this.remember(`done: ${brief.done.join('; ')}`, 'brief');
        if (brief.open?.length > 0) this.remember(`open: ${brief.open.join('; ')}`, 'brief');
        for (const ref of brief.refs) {
            this.remember(`${ref.type}: ${ref.value}`, 'brief');
        }
        if (current?.outcome) this.remember(this.outcomeLine('current', current), 'brief');
        for (const entry of (brief.situation ?? []).slice(-Scratchpad.SituationSeedLimit)) {
            const remaining = entry.remaining.slice(0, Scratchpad.OutcomeListSeedLimit).join('; ');
            this.remember(
                `situation ${entry.speakerId}: intent=${entry.intent}, goal=${entry.goal} -> ${entry.result}${remaining.length > 0 ? `, remaining=[${remaining}]` : ''}`,
                'brief',
            );
        }
        let peerSeeds = 0;
        for (const turn of brief.workspace ?? []) {
            if (turn.turnId === brief.turnId || turn.outcome === undefined) continue;
            if (peerSeeds >= Scratchpad.PeerOutcomeSeedLimit) break;
            this.remember(this.outcomeLine('workspace', turn), 'brief');
            peerSeeds += 1;
        }
    }

    /**
     * EN: Adds one temporary private note, dropping oldest notes when over capacity.
     * Not a long-term memory write; notes die with the thought thread or next brief seed.
     * ZH: 添加一条临时私有笔记，超出容量时丢弃最旧笔记。不是长期记忆写入；笔记随
     * 思维线程结束或下一次简报播种而消失。
     */
    public remember(content: string, source: ScratchNote['source']): void {
        this.noteSequence += 1;
        this.notes.push({ id: `note_${this.noteSequence}`, content: content.slice(0, 1024), source, ts: Date.now() });
        if (this.notes.length > this.capacity) {
            this.notes = this.notes.slice(-this.capacity);
        }
    }

    private outcomeLine(label: string, turn: TurnBrief): string {
        const outcome = turn.outcome as TurnOutcome;
        const remaining = outcome.remaining.slice(0, Scratchpad.OutcomeListSeedLimit).join('; ');
        const decisions = outcome.decisions.slice(0, Scratchpad.OutcomeListSeedLimit).join('; ');
        const evidence = outcome.evidence.slice(0, Scratchpad.OutcomeListSeedLimit).join('; ');
        const parts = [
            `${label} ${turn.turnId} (${turn.status}): ${turn.goal} -> ${outcome.result}`,
        ];
        if (remaining.length > 0) parts.push(`remaining=[${remaining}]`);
        if (decisions.length > 0) parts.push(`decisions=[${decisions}]`);
        if (evidence.length > 0) parts.push(`evidence=[${evidence}]`);
        return parts.join(', ');
    }

    /** EN: Builds the provider message list from persona prompt sections and cached notes. ZH: 由人格提示词 section 与缓存笔记构建发往 provider 的消息列表。 */
    public buildMessages(): MindMessage[] {
        const sections = this.config.persona.promptSections?.filter((section) => section !== SoulSection.User)
            ?? [SoulSection.Soul, SoulSection.Extension];
        const system = this.prompt.render({ kind: 'sections', sections });
        const messages: MindMessage[] = system.trim().length === 0 ? [] : [{ role: ChatRole.System, content: system }];
        if (this.notes.length > 0) {
            messages.push({
                role: ChatRole.User,
                content: this.notes.map((note) => `-[${note.source}] ${note.content}`).join('\n'),
            });
        }
        return messages;
    }
}

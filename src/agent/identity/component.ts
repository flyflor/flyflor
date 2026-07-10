import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Prompt, Provide } from '@/core';
import { PromptService, type PromptPackageData } from '@/prompt';
import { AgentChatRole, type AgentBus, type AgentMemory } from '@/agent/types';

export enum IdentitySection {
    Soul = 'SOUL',
    User = 'USER',
    Agents = 'AGENTS',
    Extension = 'EXTENSION',
}

/**
 * EN: Agent identity and prompt-package ownership. Turn state deliberately lives
 * in Memory instead of being mixed into identity notes.
 * ZH: Agent 身份与提示词包的所有者。回合状态只存在于 Memory，不混入身份笔记。
 */
@Provide()
export class Identity extends FComponent {
    @Prompt((prop: Identity) => prop.agentConfig.promptPackage ?? `.config/agents/${prop.agentConfig.name}`)
    public prompt!: PromptService<string> & PromptPackageData<string>;

    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    public messages(): AgentMemory[] {
        const content = this.prompt.render({ sections: this.agentConfig.promptSections });
        return content.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content }];
    }

    public snapshot(): string {
        return JSON.stringify(Object.fromEntries(this.writable().map(([file, section]) => [file, this.prompt.section(section)])), null, 2);
    }

    public applyWrites(writes: Array<{ file?: string; content?: string }>): { written: string[]; rejected: string[] } {
        const allowed = new Map(this.writable());
        const written: string[] = [];
        const rejected: string[] = [];
        for (const write of writes) {
            const file = String(write.file ?? 'unknown');
            const section = allowed.get(file);
            const prompt = section ? this.prompt.data[section] : undefined;
            if (!prompt || typeof write.content !== 'string') {
                rejected.push(file);
                continue;
            }
            prompt.set(write.content);
            written.push(file);
        }
        return { written, rejected };
    }

    private writable(): Array<[string, string]> {
        return [
            ['SOUL.md', IdentitySection.Soul],
            ['USER.md', IdentitySection.User],
            ['EXTENSION.md', IdentitySection.Extension],
        ];
    }
}

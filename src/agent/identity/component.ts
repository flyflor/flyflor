import type { FAgentProfileConfiguration } from '@/configuration';
import { FComponent, Prompt, PromptService, Provide, type FAgentSynapseBus, type PromptPackageData } from '@/core';
import { AgentChatRole, type AgentMemory } from '@/agent/types';

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
        public readonly synapse: FAgentSynapseBus,
    ) {
        super();
    }

    public messages(): AgentMemory[] {
        const content = this.prompt.render({ kind: 'sections', sections: this.agentConfig.promptSections });
        return content.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content }];
    }
}

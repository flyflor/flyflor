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
 * EN: Durable identity and prompt-package ownership for exactly one Agent.
 * ZH: 一个 Agent 的持久身份与 prompt 协议包所有权。
 */
@Provide()
export class Identity extends FComponent {
    @Prompt((prop: Identity) => prop.agentConfig.promptPackage as string)
    public prompt!: PromptService<string> & PromptPackageData<string>;

    /** EN: Binds durable identity to one immutable Agent profile. ZH: 将持久身份绑定到一个不可变 Agent profile。 */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Projects configured identity sections into one system message.
     * ZH: 将配置的身份 sections 投影为一条 system 消息。
     */
    public messages(): AgentMemory[] {
        const content = this.prompt.render({ kind: 'sections', sections: this.agentConfig.promptSections });
        return content.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content }];
    }

    /**
     * EN: Renders the complete identity protocol package for a reviewed update.
     * ZH: 为受审查更新渲染完整身份协议包。
     */
    public snapshot(): string {
        return this.prompt.render({ kind: 'document', attributes: { agent: this.agentConfig.name } });
    }

    /**
     * EN: Applies one fully valid identity update through PromptService policy.
     * ZH: 通过 PromptService 策略应用一份完全合法的身份更新。
     */
    public applyWrites(writes: Array<{ file?: string; content?: string }>): string[] {
        return this.prompt.applyWrites(writes);
    }
}

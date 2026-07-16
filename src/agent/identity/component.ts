import type { FAgentProfileConfiguration } from '@/config';
import { FAgent, FComponent, Prompt, Provide } from '@/core';
import { PromptService } from '@/prompt';
import type { AgentBus, AgentStimulus, CompleteSignal } from '@/agent/types';
import type { TextMessage } from '@/model';

/**
 * ZH: 一个 Agent 的持久身份与 prompt 协议包所有权。
 * EN: Durable identity and prompt-package ownership for exactly one Agent.
 */
@Provide()
export class Identity extends FComponent {
    public readonly agentConfig: FAgentProfileConfiguration;

    @Prompt((prop: Identity) => prop.packagePath)
    public prompt!: PromptService<string>;

    private readonly packagePath: string;

    /**
     * ZH: 将持久身份绑定到所属 Agent 的不可变 profile。
     * EN: Binds durable identity to the immutable profile of its owning Agent.
     */
    public constructor(
        agent: FAgent<AgentStimulus, CompleteSignal, FAgentProfileConfiguration, AgentBus>,
    ) {
        super();
        this.agentConfig = agent.agentConfig;
        const packagePath = agent.agentConfig.promptPackage;
        if (typeof packagePath !== 'string' || packagePath.length === 0) throw Error(`Agent prompt package is incomplete: ${agent.agentConfig.name}`);
        this.packagePath = packagePath;
    }

    /**
     * ZH: 将配置的身份 sections 投影为一条 system 消息。
     * EN: Projects configured identity sections into one system message.
     */
    public messages(): TextMessage[] {
        const content = this.prompt.render({ kind: 'sections', sections: this.agentConfig.promptSections });
        return content.trim().length === 0 ? [] : [{ role: 'system', content }];
    }

    /**
     * ZH: 为受审查更新渲染完整身份协议包。
     * EN: Renders the complete identity protocol package for a reviewed update.
     */
    public snapshot(): string {
        return this.prompt.render({ kind: 'document', attributes: { agent: this.agentConfig.name } });
    }

    /**
     * ZH: 通过 PromptService 策略应用一份完全合法的身份更新。
     * EN: Applies one fully valid identity update through PromptService policy.
     */
    public applyWrites(writes: Array<{ file?: string; content?: string }>): string[] {
        return this.prompt.applyWrites(writes);
    }
}

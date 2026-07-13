import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Prompt, Provide } from '@/core';
import type { Message } from '@/model';
import { PromptService, type PromptPackageData } from '@/prompt';
import type { AgentBus } from '@/agent/types';
import { existsSync, statSync } from 'node:fs';

/**
 * EN: Durable identity and prompt-package ownership for exactly one Agent.
 * ZH: 一个 Agent 的持久身份与 prompt 协议包所有权。
 *
 * EN: Section order and write policy live in PromptService filename conventions.
 * ZH: section 顺序与写策略由 PromptService 的文件名约定负责。
 */
@Provide()
export class Identity extends FComponent {
    @Prompt((prop: Identity) => prop.agentConfig.promptPackage)
    public prompt!: PromptService<string> & PromptPackageData<string>;

    /**
     * EN: Binds durable identity to one immutable Agent profile.
     * ZH: 将持久身份绑定到一个不可变 Agent profile。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Projects identity into one system message for model context.
     * ZH: 将身份投影为一条 system 消息供模型上下文使用。
     */
    public messages(): Message[] {
        const path = this.agentConfig.promptPackage;
        const content = existsSync(path) && statSync(path).isDirectory()
            ? this.prompt.render({ kind: 'sections' })
            : String(this.prompt.data).trim();
        return content.trim().length === 0 ? [] : [{ role: 'system', content }];
    }

    /**
     * EN: Renders the complete identity package for a reviewed update.
     * ZH: 为受审查更新渲染完整身份包。
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

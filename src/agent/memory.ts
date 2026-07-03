import { FAgentAtom, Inject, Prompt, PromptService, Provide, type PromptPackageData } from '@/core';
import { Context } from '@/agent/context';
import { AgentChatRole, type AgentMemory } from './types';

export { AgentChatRole, type AgentMemory } from './types';

export enum SoulSection {
    /** EN: Agent identity / constitution layer loaded from `SOUL.md`. ZH: 来自 `SOUL.md` 的智能体身份/人格层。 */
    Soul = 'SOUL',

    /** EN: User profile loaded from `USER.md`. ZH: 来自 `USER.md` 的用户画像。 */
    User = 'USER',

    /** EN: Fixed protocol-package constitution loaded from `AGENTS.md`. ZH: 来自 `AGENTS.md` 的固定协议包宪法。 */
    Agents = 'AGENTS',

    /** EN: Agent extension/capability summary loaded from `EXTENSION.md`. ZH: 来自 `EXTENSION.md` 的扩展/能力摘要。 */
    Extension = 'EXTENSION',
}

/**
 * EN: Memory is a pure projection of Context into the agent's prompt input.
 * ZH: Memory 是 Context 到 agent prompt 输入的纯投影。
 */
@Provide()
export class Memory extends FAgentAtom {
    @Prompt((prop: Memory) => `.config/agents/${prop.agentConfig.name}`)
    public prompt!: PromptService<SoulSection> & PromptPackageData<SoulSection>;

    @Inject()
    public context!: Context;

    public buildMessage(): AgentMemory[] {
        const system = this.prompt.render({ kind: 'sections' });
        const messages: AgentMemory[] = system.trim().length === 0 ? [] : [{ role: AgentChatRole.System, content: system }];
        if (this.context.current) {
            messages.push({
                role: AgentChatRole.User,
                content: JSON.stringify(this.block()),
            });
        }
        return messages;
    }

    private block(): object {
        const turns = this.context.turns;
        return {
            current: this.context.current,
            recent: this.context.recent(),
            done: turns.filter((turn) => turn.status === 'completed').map((turn) => turn.summary),
        };
    }
}
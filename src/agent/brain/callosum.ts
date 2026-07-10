import { AgentChatRole, type AgentBus } from '@/agent/types';
import type { Perception, Reference, TurnSummary } from '@/agent/context';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Prompt, Provide, Scope } from '@/core';
import { Model } from '@/model';
import { PromptService } from '@/prompt';
import { parse } from '@/agent/json';

export enum CallosumPrompt {
    Perceive = 'PERCEIVE',
}

/**
 * EN: Perceives one stimulus once and returns a strict cognitive intent.
 * ZH: 对一个刺激只感知一次，并返回严格的认知意图。
 */
@Provide()
export class Callosum extends FComponent {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Scope()
    public model!: Model;

    /**
     * EN: Binds this Callosum to one Agent scope.
     * ZH: 将当前 Callosum 绑定到一个 Agent scope。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Understands the latest input against immutable completed experience.
     * ZH: 根据不可变完成经历理解最新输入。
     */
    public async perceive(input: string, recent: TurnSummary[]): Promise<Perception> {
        const document = this.prompt.render({
            kind: 'document',
            root: 'perception_input',
            blocks: [
                { tag: 'latest', content: input },
                { tag: 'recent', content: JSON.stringify(recent) },
            ],
        });
        const raw = await this.model.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(CallosumPrompt.Perceive) },
            { role: AgentChatRole.User, content: document },
        ]);
        return this.read(parse<unknown>(raw));
    }

    /**
     * EN: Validates one model perception without default routing.
     * ZH: 验证一次模型感知，不进行默认路由。
     */
    private read(value: unknown): Perception {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Perception must be an object');
        const data = value as Record<string, unknown>;
        if (data.intent !== 'reply' && data.intent !== 'research' && data.intent !== 'soul') throw Error('Perception intent is invalid');
        if (typeof data.goal !== 'string' || data.goal.length === 0) throw Error('Perception goal is invalid');
        if (!Array.isArray(data.constraints) || !data.constraints.every((item) => typeof item === 'string')) throw Error('Perception constraints are invalid');
        if (!Array.isArray(data.references) || !data.references.every((item) => this.reference(item))) throw Error('Perception references are invalid');
        if (data.cwd !== undefined && typeof data.cwd !== 'string') throw Error('Perception cwd is invalid');
        return {
            intent: data.intent,
            goal: data.goal,
            cwd: data.cwd as string | undefined,
            constraints: [...data.constraints],
            references: data.references.map((reference) => ({ ...(reference as Reference) })),
        };
    }

    /**
     * EN: Validates one normalized perception reference.
     * ZH: 验证一条规范化感知引用。
     */
    private reference(value: unknown): value is Reference {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
        const reference = value as Record<string, unknown>;
        return (reference.type === 'path'
            || reference.type === 'error'
            || reference.type === 'command'
            || reference.type === 'symbol'
            || reference.type === 'text')
            && typeof reference.value === 'string';
    }
}

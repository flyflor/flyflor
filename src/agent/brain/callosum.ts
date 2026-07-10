import { AgentChatRole, type AgentBus } from '@/agent/types';
import type { Perception, Reference, TurnMode, TurnSnapshot } from '@/agent/turn';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Prompt, Provide, Scope } from '@/core';
import { Model } from '@/model';
import { PromptService } from '@/prompt';
import { parse } from '@/agent/json';

export enum CallosumPrompt {
    Perceive = 'PERCEIVE',
}

@Provide()
export class Callosum extends FComponent {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Scope()
    public model!: Model;

    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Understands and routes one input in a single model request.
     * ZH: 在一次模型请求中同时完成输入理解与路由。
     */
    public async perceive(input: string, recent: TurnSnapshot[]): Promise<Perception> {
        const raw = await this.model.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(CallosumPrompt.Perceive) },
            { role: AgentChatRole.User, content: JSON.stringify({ latest: input, recent }) },
        ]);
        return this.perception(parse<unknown>(raw));
    }

    private perception(value: unknown): Perception {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Perception must be an object');
        const data = value as Record<string, unknown>;
        const mode = this.mode(data.mode);
        if (typeof data.goal !== 'string' || data.goal.length === 0) throw Error('Perception goal is invalid');
        if (!Array.isArray(data.constraints) || !data.constraints.every((item) => typeof item === 'string')) throw Error('Perception constraints are invalid');
        if (!Array.isArray(data.references) || !data.references.every((item) => this.reference(item))) throw Error('Perception references are invalid');
        if (data.cwd !== undefined && typeof data.cwd !== 'string') throw Error('Perception cwd is invalid');
        return {
            mode,
            goal: data.goal,
            cwd: data.cwd as string | undefined,
            constraints: [...data.constraints],
            references: data.references.map((reference) => ({ ...(reference as Reference) })),
        };
    }

    private mode(value: unknown): TurnMode {
        if (value === 'reply' || value === 'research' || value === 'soul' || value === 'coordinate') return value;
        return 'research';
    }

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

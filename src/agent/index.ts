import { FlyFlor, Inject, Init, Prompt, Provide, Config, PromptScope } from '@/core';
import { AgentChatRole, CrystallService, IntelligenceService, type AgentChatMessage } from './brain';
import type { FAgentProfileConfiguration } from '@/shard/components';
import { join } from 'path';
import { cpSync, mkdirSync } from 'fs';
import { ROOT_PATH } from '@/constants';

/**
 * Runtime agent worker backed by one configured profile.
 * It owns prompt assembly for a user turn and delegates model completion to `IntelligenceService`.
 */
@Provide()
export class Agent extends FlyFlor {
    /** Prompt file key for the agent task loop instructions. */
    private static readonly PROMPT_AGENTS_KEY = 'AGENTS';

    /** Prompt file key for the agent identity instructions. */
    private static readonly PROMPT_SOUL_KEY = 'SOUL';

    /** Prompt file key for the user profile instructions. */
    private static readonly PROMPT_USER_KEY = 'USER';

    /** Separator used between prompt documents in the combined system prompt. */
    private static readonly PROMPT_SEPARATOR = '\n\n';

    @Config('path')
    public configPath!: string;

    // llm 模型 - 流体治理
    @Inject()
    public intelligence!: IntelligenceService;

    // gem 结晶 - 晶体智力
    @Inject()
    public crystall!: CrystallService;

    // 灵魂 - 心灵智慧/宪法层
    @Prompt('agent', PromptScope.AGENT, function (this: Agent) {
        return this.config.name;
    })
    public prompt!: { [x: string]: string };

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    @Init()
    public init(): void {
        const { name } = this.config;
        const agentsPath = join(this.configPath, 'agents');
        mkdirSync(agentsPath, { recursive: true });
        const agentPath = join(agentsPath, name);
        mkdirSync(agentPath, { recursive: true });
        cpSync(join(ROOT_PATH, 'prompts/agent'), agentPath, { recursive: true, force: false });
    }

    /**
     * Completes one user turn through the configured LLM.
     * @param content - Raw user text for the current turn.
     * @returns Assistant text produced by the model.
     */
    public async chat(content: string): Promise<string> {
        const messages: AgentChatMessage[] = [
            { role: AgentChatRole.System, content: this.systemPrompt() },
            { role: AgentChatRole.User, content },
        ];
        console.log(111, messages);
        return this.intelligence.complete(messages);
    }

    /**
     * Builds the system prompt from the current agent prompt files.
     * @returns Ordered prompt text passed to the model as the system message.
     */
    private systemPrompt(): string {
        const prompt = this.prompt;
        return [prompt[Agent.PROMPT_SOUL_KEY], prompt[Agent.PROMPT_USER_KEY], prompt[Agent.PROMPT_AGENTS_KEY]]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join(Agent.PROMPT_SEPARATOR);
    }
}

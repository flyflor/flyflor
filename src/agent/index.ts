import { FlyFlor, Inject, Init, Prompt, Provide, Config, PromptScope } from '@/core';
import type { CrystallService, IntelligenceService } from './brain';
import type { FAgentProfileConfiguration } from '@/shard/components';
import { join } from 'path';
import { cpSync, mkdirSync } from 'fs';
import { ROOT_PATH } from '@/constants';

@Provide()
export class Agent extends FlyFlor {

    @Config('path')
    public configPath!: string;

    // llm 模型 - 流体治理
    @Inject()
    public intelligence!: IntelligenceService;

    // gem 结晶 - 晶体智力
    @Inject()
    public crystall!: CrystallService;

    // 灵魂 - 心灵智慧/宪法层
    @Prompt('agent', PromptScope.AGENT, function (this: Agent) { return this.config.name; })
    public prompt!: { [x: string]: string };

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    @Init()
    public init(): void {
        // console.log(123123, this.config);
        const { name } = this.config;
        const agentsPath = join(this.configPath, 'agents');
        mkdirSync(agentsPath, { recursive: true });
        const agentPath = join(agentsPath, name);
        mkdirSync(agentPath, { recursive: true });
        cpSync(join(ROOT_PATH, 'prompts/agent'), agentPath, { recursive: true, force: false });
        // console.log('Agent initialized', this.intelligence, this.crystall, this.prompt);
    }
}

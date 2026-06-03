import { Component, Inject, Prompt } from '@/core';
import type { CrystallService, IntelligenceService } from './brain';

@Component()
export class AgentComponent {
    // llm 模型 - 流体治理
    @Inject()
    public intelligence!: IntelligenceService;

    // gem 结晶 - 晶体智力
    @Inject()
    public crystall!: CrystallService;

    // 灵魂 - 心灵智慧/宪法层
    @Prompt('agent')
    public prompt!: { [x: string]: string };

    constructor() {
        console.log('AgentComponent initialized', this.intelligence, this.crystall, this.prompt);
    }
}

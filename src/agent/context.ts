import { CrystallService, IntelligenceService, SoulService } from "@/agent/mind";
import { Component, Inject } from "@/core";

@Component()
export class ContextComponent {
    // llm 模型 - 流体治理
    @Inject()
    public intelligence!: IntelligenceService;

    // gem 结晶 - 晶体智力
    @Inject()
    public crystall!: CrystallService;

    // 灵魂 - 心灵智慧/宪法层
    @Inject()
    public soul!: SoulService;
}

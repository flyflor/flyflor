import { Inject, Prompt, Provide, Config, PromptScope, Logger, FAgent } from '@/core';
import { CrystallService, IntelligenceService } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';
import type { SocketPacket } from '@/neural/ipc/scoket';
import type { MemoryComponent } from '@/agent/memory';

@Provide()
export class Agent extends FAgent {
    @Config('path')
    private readonly configRoot!: string;

    @Inject()
    public intelligence!: IntelligenceService;

    @Inject()
    public crystall!: CrystallService;

    @Inject()
    public memory!: MemoryComponent;

    @Inject()
    public configComponent!: ConfigComponent;

    @Logger('agent')
    public readonly log!: FLogger;

    /**
     * The four canonical soul documents loaded from `.config/agents/<name>/` via the `@Prompt`
     * decorator. The map keys come from `SoulSection` enum values so the section order is declared,
     * not hardcoded.
     */
    @Prompt('agent', PromptScope.AGENT, function (this: Agent) {
        return this.config.name;
    })
    public prompt!: { [x: string]: string };

    constructor(public readonly config: FAgentProfileConfiguration) {
        super();
    }

    public pipe(data: SocketPacket) {
        this.log.debug(data);
    }
}

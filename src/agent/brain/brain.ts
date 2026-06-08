import { FileService, FService, Inject, Logger, Prompt, Service, useContainer, type FLogger } from '@/core';
import { AgentChatRole, Intelligence, type AgentMemory } from './intelligence';
import { Crystall } from './crystall';
import { Memory } from '../memory';
import { SoulSection } from '../types';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import { Investigation, type BrainInvestigationResult } from './investigation';

const PROMPT_SECTION_ORDER = [SoulSection.Soul, SoulSection.User, SoulSection.Agents, SoulSection.Memory] as const;

type PromptSection = (typeof PROMPT_SECTION_ORDER)[number];

type AgentPrompt = Partial<Record<PromptSection, string>>;

@Service()
export class Brain extends FService {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public crystall!: Crystall;

    public context: AgentMemory[];

    @Inject(function (this: Brain) {
        return this.config;
    })
    public investigation!: Investigation;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    @Prompt('agent', function wrapper(this: Brain) {
        return this.config.name;
    })
    public prompt!: FileService<AgentPrompt>;

    constructor(public config: FAgentProfileConfiguration) {
        super();
        this.context = [];
    }

    public async *transformer(content: string): AsyncGenerator<string> {
        this.log.debug('transformer', content);
    }
}

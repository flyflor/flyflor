import { FileService, FService, Inject, Logger, Prompt, Service, type FLogger } from "@/core";
import { AgentChatRole, Intelligence, type AgentChatMessage } from "./intelligence";
import { Crystall } from "./crystall";
import { Memory } from "../memory";
import type { FAgentProfileConfiguration } from "@/config";

const PROMPT_SECTION_ORDER = ['SOUL', 'USER', 'AGENTS', 'MEMORY'] as const;

type PromptSection = (typeof PROMPT_SECTION_ORDER)[number];

type AgentPrompt = Partial<Record<PromptSection, string>>;

@Service()
export class Brain extends FService {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public crystall!: Crystall;

    @Inject()
    public memory!: Memory;

    @Logger(Brain.name)
    public readonly log!: FLogger;
    
    @Prompt('agent', function wrapper(this: Brain) {
        return this.config.name;
    })
    public prompt!: FileService<AgentPrompt>;
    
    public context: AgentChatMessage[] = [];

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public transformer(content: string) {
        // this.context.push({ role: AgentChatRole.User, content });
        // return this.context;
        this.log.debug('transformer', content);
        return 'hello';
    }
}

import { Inject, Prompt, Provide, PromptScope, Logger, FAgent } from '@/core';
import { AgentChatRole, CrystallService, IntelligenceService, type AgentChatMessage } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';
import type { SocketPacket } from '@/neural/packet';
import { MemoryService } from '@/agent/memory';

const PROMPT_SECTION_ORDER = ['SOUL', 'USER', 'AGENTS', 'MEMORY'] as const;

type PromptSection = (typeof PROMPT_SECTION_ORDER)[number];

@Provide()
export class Agent extends FAgent<SocketPacket> {
    @Inject()
    public intelligence!: IntelligenceService;

    @Inject()
    public crystall!: CrystallService;

    @Inject()
    public memory!: MemoryService;

    @Inject()
    public config!: ConfigComponent;

    @Logger('agent')
    public readonly log!: FLogger;

    @Prompt('agent', PromptScope.AGENT, function wrapper(this: Agent) {
        return this.agentConfig.name;
    })
    public prompt!: { [x: string]: string };

    public context: AgentChatMessage[] = [];

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
        this.log.debug(this.prompt);
        this.subscribe((data: any) => {
            this.log.debug(data);
        });
    }

    public pushUser(content: string): AgentChatMessage[] {
        this.context.push({ role: AgentChatRole.User, content });
        return this.messages();
    }

    public pushAssistant(content: string): AgentChatMessage[] {
        this.context.push({ role: AgentChatRole.Assistant, content });
        return this.messages();
    }

    public messages(): AgentChatMessage[] {
        return [
            {
                role: AgentChatRole.System,
                content: this.systemContext(),
            },
            ...this.context,
        ];
    }

    public systemContext(): string {
        const sections: string[] = [];
        for (const section of PROMPT_SECTION_ORDER) {
            const content = this.prompt[section];
            if (typeof content !== 'string' || content.trim().length === 0) {
                continue;
            }
            sections.push(this.renderPromptSection(section, content));
        }
        return sections.join('\n\n');
    }

    private renderPromptSection(section: PromptSection, content: string): string {
        return `<${section}>\n${content.trim()}\n</${section}>`;
    }
}

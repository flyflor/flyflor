import { Inject, Provide, Logger, FAgent } from '@/core';
import { AgentChatRole, Brain, type AgentChatMessage } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';
import type { SocketPacket } from '@/neural/packet';



@Provide()
export class Agent extends FAgent<SocketPacket> {
    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public brain!: Brain;

    @Inject()
    public config!: ConfigComponent;

    @Logger('agent')
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public override async next(data: SocketPacket) {
        this.log.debug(data);
        await this.brain.transformer('');
        return await super.next(data);
    }

    // public pushUser(content: string): AgentChatMessage[] {
    //     this.context.push({ role: AgentChatRole.User, content });
    //     return this.messages();
    // }

    // public pushAssistant(content: string): AgentChatMessage[] {
    //     this.context.push({ role: AgentChatRole.Assistant, content });
    //     return this.messages();
    // }

    // /**
    //  * Runs one model-backed chat turn.
    //  *
    //  * The new user message is included in the outbound message list immediately, but the in-memory history is
    //  * updated only after the provider returns a valid assistant response. That keeps failed provider calls from
    //  * becoming permanent conversation context.
    //  */
    // public async chat(content: string): Promise<string> {
    //     const messages = [
    //         ...this.messages(),
    //         {
    //             role: AgentChatRole.User,
    //             content,
    //         },
    //     ];
    //     const response = await this.intelligence.complete(messages, this.agentConfig.model || undefined);
    //     this.context.push({ role: AgentChatRole.User, content });
    //     this.context.push({ role: AgentChatRole.Assistant, content: response });
    //     return response;
    // }

    // /**
    //  * Builds the provider-facing chat message list.
    //  *
    //  * `system/user/assistant` are model protocol roles. They are intentionally separate from Flyflor prompt section
    //  * names such as `SOUL` and `MEMORY`, which are internal structure inside the single system message.
    //  */
    // public messages(): AgentChatMessage[] {
    //     const sections: string[] = [];
    //     for (const section of PROMPT_SECTION_ORDER) {
    //         const content = this.prompt.data[section];
    //         if (typeof content !== 'string' || content.trim().length === 0) {
    //             continue;
    //         }
    //         sections.push(`<${section}>\n${content.trim()}\n</${section}>`);
    //     }
    //     return [
    //         {
    //             role: AgentChatRole.System,
    //             content: sections.join('\n\n'),
    //         },
    //         ...this.context,
    //     ];
    // }
}

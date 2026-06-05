import { Inject, Prompt, Provide, Logger, FAgent, type FileService } from '@/core';
import { AgentChatRole, Crystall, Intelligence, type AgentChatMessage } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';
import type { SocketPacket } from '@/neural/packet';
import { Memory } from '@/agent/memory';

const PROMPT_SECTION_ORDER = ['SOUL', 'USER', 'AGENTS', 'MEMORY'] as const;

type PromptSection = (typeof PROMPT_SECTION_ORDER)[number];

/**
 * Runtime shape loaded from `.config/agents/{agentName}` by `@Prompt`.
 *
 * Each key maps to one canonical prompt markdown file, e.g. `SOUL.md -> data.SOUL`. The type is partial because
 * an agent directory may omit optional sections while the context renderer still keeps a stable section order.
 */
type AgentPrompt = Partial<Record<PromptSection, string>>;

@Provide()
export class Agent extends FAgent<SocketPacket> {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public crystall!: Crystall;

    @Inject()
    public memory!: Memory;

    @Inject()
    public config!: ConfigComponent;

    @Logger('agent')
    public readonly log!: FLogger;

    /**
     * The agent's prompt is a loaded file object, not raw text.
     *
     * `@Prompt('agent', resolver)` binds this property to `.config/agents/{agentName}` at runtime. The resolver is
     * called from the property getter so it can read `this.agentConfig.name` after the Agent instance exists.
     *
     * `prompt.data` holds the renderable prompt sections. `prompt.blocks` holds parsed `<flyflor:xxx>` protocol
     * blocks for application-level controls. Agent context assembly should consume those in-memory values and must
     * not perform filesystem reads directly.
     */
    @Prompt('agent', function wrapper(this: Agent) {
        return this.agentConfig.name;
    })
    public prompt!: FileService<AgentPrompt>;

    /**
     * Conversation turns after the system prompt.
     *
     * The LLM provider sees a fresh ordered message list on every call: one synthesized `system` message first,
     * followed by this user/assistant history. The prompt files themselves are not appended here; they are folded
     * into `systemContext()`.
     */
    public context: AgentChatMessage[] = [];

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
        // this.log.debug(this.prompt.data);
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

    /**
     * Runs one model-backed chat turn.
     *
     * The new user message is included in the outbound message list immediately, but the in-memory history is
     * updated only after the provider returns a valid assistant response. That keeps failed provider calls from
     * becoming permanent conversation context.
     */
    public async chat(content: string): Promise<string> {
        const messages = [
            ...this.messages(),
            {
                role: AgentChatRole.User,
                content,
            },
        ];
        const response = await this.intelligence.complete(messages, this.agentConfig.model || undefined);
        this.context.push({ role: AgentChatRole.User, content });
        this.context.push({ role: AgentChatRole.Assistant, content: response });
        return response;
    }

    /**
     * Builds the provider-facing chat message list.
     *
     * `system/user/assistant` are model protocol roles. They are intentionally separate from Flyflor prompt section
     * names such as `SOUL` and `MEMORY`, which are internal structure inside the single system message.
     */
    public messages(): AgentChatMessage[] {
        const sections: string[] = [];
        for (const section of PROMPT_SECTION_ORDER) {
            const content = this.prompt.data[section];
            if (typeof content !== 'string' || content.trim().length === 0) {
                continue;
            }
            sections.push(`<${section}>\n${content.trim()}\n</${section}>`);
        }
        return [
            {
                role: AgentChatRole.System,
                content: sections.join('\n\n'),
            },
            ...this.context,
        ];
    }
}

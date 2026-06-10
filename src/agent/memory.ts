import { includes } from 'lodash-es';
import { type FAgentProfileConfiguration } from '@/config';
import { Component, FComponent, Inject, Logger, PromptService, type FLogger } from '@/core';
import { AgentChatRole, type AgentMemory } from './brain/intelligence';
import { SoulSection } from './types';

export type MemoryMessageResult = AgentMemory[];

const PROMPT_SECTION_ORDER = [SoulSection.Soul, SoulSection.User, SoulSection.Extension] as const;
const PROMPT_SECTION_FILES: Record<SoulSection | string, string> = {
    [SoulSection.Soul]: 'SOUL.md',
    [SoulSection.User]: 'USER.md',
    [SoulSection.Agents]: 'AGENTS.md',
    [SoulSection.Extension]: 'EXTENSION.md',
};
const RUNTIME_IGNORED_FILES = ['AGENTS.md'] as const;
@Component()
export class Memory extends FComponent {
    @Inject(function (this: Memory) {
        return this.config;
    })
    public prompt!: PromptService;

    @Logger(Memory.name)
    public readonly log!: FLogger;

    public context: AgentMemory[] = [];

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    /**
     * Commits one finished turn to working memory.
     * Called only after a turn succeeds, so the context holds whole user/assistant pairs.
     */
    public commit(user: string, assistant: string): void {
        this.context.push({ role: AgentChatRole.User, content: user });
        this.context.push({ role: AgentChatRole.Assistant, content: assistant });
    }

    public buildMessage(content: string): AgentMemory[] {
        const rendered: string[] = [];
        const sections = this.prompt.prompts.config?.data?.prompt?.sections ?? PROMPT_SECTION_ORDER;
        const ignored = new Set([
            ...RUNTIME_IGNORED_FILES,
            ...(this.prompt.prompts.config?.data?.protocolPackage?.runtimeIgnored ?? []),
        ]);
        for (const section of sections) {
            if (!includes(Object.values(SoulSection), section)) continue;
            if (ignored.has(PROMPT_SECTION_FILES[section]!)) continue;
            const content = this.prompt.prompts[section]?.data;
            if (typeof content !== 'string' || content.trim().length === 0) continue;
            rendered.push(`<${section}>\n${content.trim()}\n</${section}>`);
        }
        const system = rendered.join('\n\n');
        const messages = system.length > 0 ? [{ role: AgentChatRole.System, content: system }] : [];
        return [...messages, ...this.context, { role: AgentChatRole.User, content }];
    }
}

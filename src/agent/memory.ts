import { type FAgentProfileConfiguration } from '@/config';
import { FAgentAtom, Logger, Prompt, PromptService, Provide, type FLogger, type PromptPackageData } from '@/core';
import { includes } from 'lodash-es';
import type { PendingResearch } from './research.types';

export enum SoulSection {
    /** Agent identity / constitution layer. Loaded from `SOUL.md`. */
    Soul = 'SOUL',

    /** User profile (画像). Loaded from `USER.md`. */
    User = 'USER',

    /** Fixed protocol-package constitution. Loaded from `AGENTS.md`. */
    Agents = 'AGENTS',

    /** Agent extension/capability summary. Loaded from `EXTENSION.md`. */
    Extension = 'EXTENSION',
}

/**
 * Roles accepted by provider chat protocols.
 * These values are provider protocol strings, not Flyflor context section names.
 */
export enum AgentChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
}

/**
 * One message sent to the configured LLM provider.
 * `role` is the provider protocol role; `content` is the text payload for that message.
 */
export interface AgentMemory {
    role: AgentChatRole;
    content: string;
}

@Provide()
export class Memory extends FAgentAtom {
    @Prompt(function (this: Memory) {
        return `.config/agents/${this.agentConfig.name}`;
    })
    public prompt!: PromptService<SoulSection> & PromptPackageData<SoulSection>;

    @Logger(Memory.name)
    public readonly log!: FLogger;

    public context: AgentMemory[] = [];

    public pendingResearch?: PendingResearch;

    private commitUserOverride?: string;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public buildMessage(content: string) {
        const rendered: string[] = [];
        const sections = this.prompt.config?.prompt?.sections ?? [];
        for (const section of sections) {
            if (!includes(Object.values(SoulSection), section)) continue;
            const content = this.prompt.data[section]?.data;
            if (typeof content !== 'string' || content.trim().length === 0) continue;
            rendered.push(`<${section}>\n${content.trim()}\n</${section}>`);
        }
        const system = rendered.join('\n\n');
        const messages = system.length > 0 ? [{ role: AgentChatRole.System, content: system }] : [];
        return [...messages, ...this.context, { role: AgentChatRole.User, content }];
    }

    /**
     * Commits one finished turn to working memory.
     * Called only after a turn succeeds, so the context holds whole user/assistant pairs.
     */
    public commit(user: string, assistant: string): void {
        this.context.push({ role: AgentChatRole.User, content: this.consumeCommitUserOverride(user) });
        this.context.push({ role: AgentChatRole.Assistant, content: assistant });
    }

    public useCommitUser(user: string): void {
        this.commitUserOverride = user;
    }

    private consumeCommitUserOverride(user: string): string {
        const value = this.commitUserOverride ?? user;
        this.commitUserOverride = undefined;
        return value;
    }
}

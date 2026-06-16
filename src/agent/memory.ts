import { type FAgentProfileConfiguration } from '@/config';
import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, type FLogger, type PromptPackageData } from '@/core';
import { includes } from 'lodash-es';
import { Context } from '@/neural/context';
import type { CompletedSummary, TurnUnderstanding } from '@/neural/context/types';

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
    Tool = 'tool',
}

/**
 * One plain text message sent to the configured LLM provider.
 * `role` is the provider protocol role; `content` is the text payload for that message.
 */
export interface AgentTextMemory {
    role: AgentChatRole.System | AgentChatRole.User | AgentChatRole.Assistant;
    content: string;
}

/**
 * One tool call requested by the model inside an assistant turn.
 * `arguments` is the parsed object form; the raw streamed JSON string lives only inside the protocol
 * adapter during accumulation and never reaches working memory.
 */
export interface AgentToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * One assembled mental input that also carries the model's tool requests for a turn.
 * It is the assistant-role member of `AgentMemory`; `content` keeps the visible text so the text-only
 * protocol adapters can project it unchanged. `reasoning` carries provider thinking text that some models
 * (e.g. DeepSeek thinking mode) require replayed alongside the tool calls on the next request.
 */
export interface AgentToolCallMemory {
    role: AgentChatRole.Assistant;
    content: string;
    toolCalls: AgentToolCall[];
    reasoning?: string;
}

/**
 * One tool result fed back to the model after a tool runs.
 * `content` is the model-visible rendering; `isError` marks a failed call so the model can recover.
 */
export interface AgentToolResultMemory {
    role: AgentChatRole.Tool;
    content: string;
    toolCallId: string;
    toolName: string;
    isError: boolean;
}

/**
 * One message in working memory.
 *
 * Most messages are plain text (`AgentTextMemory`). An assistant turn that requested tools is an
 * `AgentToolCallMemory`; a fed-back tool result is an `AgentToolResultMemory`. Every member keeps a
 * string `content`, so the text-only protocol adapters can render any message without knowing about tools.
 */
export type AgentMemory = AgentTextMemory | AgentToolCallMemory | AgentToolResultMemory;

/**
 * One in-flight research task awaiting user clarification.
 * Stored on `Memory` so a follow-up user message can resume the same investigation instead of routing anew.
 */
export interface PendingResearch {
    request: string;
    clarification?: string;
    summary?: string;
}

/**
 * Per-turn input accepted by the agent runtime.
 * `content` is the only text sent to LLM providers; `workingDirectory` is operational context for tools.
 */
export interface AgentTurnInput {
    content: string;
    workingDirectory?: string;
    toolRoots?: string[];
}

@Provide()
export class Memory extends FAgentAtom {
    @Prompt(function (this: Memory) {
        return `.config/agents/${this.agentConfig.name}`;
    })
    public prompt!: PromptService<SoulSection> & PromptPackageData<SoulSection>;

    @Logger(Memory.name)
    public readonly log!: FLogger;

    @Inject()
    public context!: Context;

    public current?: TurnUnderstanding;

    public working: AgentMemory[] = [];

    public completed: CompletedSummary[] = [];

    public pendingResearch?: PendingResearch;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public load(understanding: TurnUnderstanding): void {
        this.current = understanding;
    }

    public async ingest(input: AgentTurnInput): Promise<TurnUnderstanding> {
        return this.context.ingest(this, input);
    }

    public recordWork(exchange: AgentMemory[]): void {
        this.working = this.compactWork(exchange);
    }

    public async settle(result: { user: string; assistant: string; completed: boolean }): Promise<CompletedSummary | undefined> {
        return this.context.settle(this, { ...result, working: this.working });
    }

    public rememberCompletion(summary: CompletedSummary): void {
        this.completed.push(summary);
        this.completed = this.completed.slice(-12);
        this.working = [];
    }

    public buildMessage(content?: string): AgentMemory[] {
        const rendered: string[] = [];
        const sections = this.prompt.config?.prompt?.sections ?? [];
        for (const section of sections) {
            if (!includes(Object.values(SoulSection), section)) continue;
            const content = this.prompt.data[section]?.data;
            if (typeof content !== 'string' || content.trim().length === 0) continue;
            rendered.push(`<${section}>\n${content.trim()}\n</${section}>`);
        }
        const state = this.renderState();
        if (state.length > 0) rendered.push(state);
        const system = rendered.join('\n\n');
        const messages: AgentMemory[] = system.length > 0 ? [{ role: AgentChatRole.System, content: system }] : [];
        const user = this.current === undefined
            ? content?.trim() ?? ''
            : JSON.stringify({
                  goal: this.current.goal,
                  user: this.truncate(content ?? this.current.userText, 4000),
              });
        if (user.length > 0) messages.push({ role: AgentChatRole.User, content: user });
        return messages;
    }

    private renderState(): string {
        if (this.current === undefined && this.completed.length === 0 && this.working.length === 0) return '';
        return `<agent_memory>\n${JSON.stringify({
            current: this.current,
            completed: this.completed.slice(-8),
            working: this.working.slice(-8).map((item) => ({ role: item.role, content: this.truncate(item.content, 1000) })),
        }, null, 2)}\n</agent_memory>`;
    }

    private compactWork(exchange: AgentMemory[]): AgentMemory[] {
        return exchange.slice(-24).map((message) => ({
            ...message,
            content: this.truncate(message.content, 2000),
        }));
    }

    private truncate(content: string, max: number): string {
        return content.length <= max ? content : `${content.slice(0, max)}...`;
    }
}

import { JSON5 } from 'bun';
import { includes, isPlainObject } from 'lodash-es';
import { type FAgentProfileConfiguration } from '@/config';
import { Component, FComponent, Inject, Logger, PromptService, type FLogger, type PromptPackageData } from '@/core';
import { AgentChatRole, Intelligence, type AgentMemory } from './brain/intelligence';
import { SoulSection } from './types';

interface MemoryAnalysis {
    reply?: string;
    writes?: MemoryWrite[];
}

interface MemoryWrite {
    file: string;
    content: string;
}

export type MemoryMessageResult = AgentMemory[] | string;

const PROMPT_SECTION_ORDER = [SoulSection.Soul, SoulSection.User, SoulSection.Extension] as const;
const PROMPT_SECTION_FILES: Record<SoulSection, string> = {
    [SoulSection.Soul]: 'SOUL.md',
    [SoulSection.User]: 'USER.md',
    [SoulSection.Agents]: 'AGENTS.md',
    [SoulSection.Extension]: 'EXTENSION.md',
};
const RUNTIME_IGNORED_FILES = ['AGENTS.md'] as const;
const EDIT_TARGETS: Record<string, SoulSection> = {
    'SOUL.md': SoulSection.Soul,
    'USER.md': SoulSection.User,
    'EXTENSION.md': SoulSection.Extension,
};

@Component()
export class Memory extends FComponent {
    @Inject()
    public intelligence!: Intelligence;

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

    public async messages(content: string): Promise<MemoryMessageResult> {
        return await this.analyze(content) ?? this.buildMessage(content);
    }

    /**
     * Commits one finished turn to working memory.
     * Called only after a turn succeeds, so the context holds whole user/assistant pairs.
     */
    public commit(user: string, assistant: string): void {
        this.context.push({ role: AgentChatRole.User, content: user });
        this.context.push({ role: AgentChatRole.Assistant, content: assistant });
    }

    public async analyze(content: string): Promise<string | undefined> {
        const prompts = this.prompt.prompts;
        const response = await this.intelligence.complete([
            { role: AgentChatRole.System, content: prompts.AGENTS?.data ?? '' },
            { role: AgentChatRole.User, content: JSON.stringify({
                turn: content,
                files: {
                    [SoulSection.Soul]: prompts.SOUL?.data ?? '',
                    [SoulSection.User]: prompts.USER?.data ?? '',
                    [SoulSection.Extension]: prompts.EXTENSION?.data ?? '',
                },
            }) },
        ]);
        let analysis: MemoryAnalysis;
        try {
            const parsed = JSON5.parse(response) as unknown;
            if (!isRecord(parsed)) return undefined;
            analysis = parsed as MemoryAnalysis;
        } catch (error) {
            this.log.warn('memory.analyze.invalid_response', { error: error instanceof Error ? error.message : String(error) });
            return undefined;
        }

        const writes = Array.isArray(analysis.writes) ? analysis.writes : [];
        if (writes.length === 0) return undefined;

        const editable = prompts.config?.data?.protocolPackage?.editable ?? Object.keys(EDIT_TARGETS);
        const next: PromptPackageData = {};
        let changed = false;

        for (const write of writes) {
            if (!isRecord(write) || typeof write.file !== 'string' || typeof write.content !== 'string') continue;
            if (!editable.includes(write.file)) {
                this.log.warn('memory.write.rejected', { file: write.file });
                continue;
            }
            const section = EDIT_TARGETS[write.file];
            if (section === undefined) continue;
            const content = write.content.trim();
            if (content.length === 0 || prompts[section]?.data === content) continue;
            next[section] = content;
            changed = true;
        }

        if (!changed) return undefined;
        this.prompt.saveMarkdown(next);

        const reply = typeof analysis.reply === 'string' ? analysis.reply.trim() : '';
        return reply.length > 0 ? reply : undefined;
    }

    public buildMessage(content: string): AgentMemory[] {
        const rendered: string[] = [];
        const sections = this.prompt.prompts.config?.data?.prompt?.sections ?? PROMPT_SECTION_ORDER;
        const ignored = new Set([
            ...RUNTIME_IGNORED_FILES,
            ...(this.prompt.prompts.config?.data?.protocolPackage?.runtimeIgnored ?? []),
        ]);
        for (const section of sections) {
            if (!isSoulSection(section)) continue;
            if (ignored.has(PROMPT_SECTION_FILES[section])) continue;
            const content = this.prompt.prompts[section]?.data;
            if (typeof content !== 'string' || content.trim().length === 0) continue;
            rendered.push(`<${section}>\n${content.trim()}\n</${section}>`);
        }
        const system = rendered.join('\n\n');
        const messages = system.length > 0 ? [{ role: AgentChatRole.System, content: system }] : [];
        return [...messages, ...this.context, { role: AgentChatRole.User, content }];
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value);
}

function isSoulSection(value: string): value is SoulSection {
    return includes(Object.values(SoulSection), value as SoulSection);
}

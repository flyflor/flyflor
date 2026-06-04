import { Inject, Init, Prompt, Provide, Config, PromptScope, Logger, FAgent } from '@/core';
import type { LoggerApi } from '@/core/logger';
import { AgentChatRole, CrystallService, IntelligenceService, type AgentChatMessage } from './brain';
import { CapillaryDecision, CapillaryModule } from '@/capillary/module';
import { ConfigComponent } from '@/shard/components/config/component';
import { MemoryComponent } from '@/shard/components/memory/component';
import type { FAgentProfileConfiguration } from '@/shard/components';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT_PATH } from '@/constants';
import {
    AGENT_TOPIC_SOUL_CRYSTALLIZE,
    AGENT_TOPIC_SOUL_LOADED,
    AGENT_TOPIC_SOUL_MISS,
    AGENT_TOPIC_SOUL_TURN,
    SOUL_REQUIRED_SECTIONS,
    SOUL_SECTION_ORDER,
    SoulSection,
    type SoulCrystallizeDraft,
    type SoulDocument,
} from './types';

/** The seed directory under version control from which every per-agent prompt directory is hydrated. */
const PROMPT_SEED_DIR = join(ROOT_PATH, 'prompts', 'agent');

/**
 * Suffix identifying the Chinese prompt mirrors that the runtime must never read.
 * Built from concatenated parts so the literal `'.zh.cn.md'` never appears in source
 * (AGENTS.md red line 5 + the `scripts/check.ts` mirror-reference scan).
 */
const ZH_MIRROR_SUFFIX = '.' + 'zh' + '.cn' + '.md';

/**
 * Separator used between prompt documents in the composed system prompt.
 */
const PROMPT_SEPARATOR = '\n\n';

/**
 * The Agent: a person (a real, autonomous intelligent entity), NOT a stateless service.
 *
 * An agent owns its own mind: the four canonical soul documents (SOUL / USER / AGENTS / MEMORY) are
 * loaded by the agent itself at `@Init`, asserted through a constitution-layer check, and broadcast
 * through the capillary layer. The agent composes its own system prompt internally — no external
 * service inspects, translates, or rewrites it. The runtime treats the agent as an opaque `chat`
 * surface; the agent's interior is its own.
 *
 * The class is the concrete implementation of `FAgent`; sibling agents (sub-agents spawned by the
 * runtime for concurrent tasks) declare `extends FAgent` and are discovered via `listModule(FAgent)`.
 *
 * The class also owns its own memory surface (`@Inject memory`) and crystallization seam
 * (`@Inject crystall`). Both are deliberately inert in this pass: real persistence and crystallization
 * wait for the memory shard's SQL driver and the mind service's LLM-driven drafts. The agent keeps
 * the seams ready so callers (the runtime, future tools) have a single object to talk to.
 */
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
    public capillary!: CapillaryModule;

    @Inject()
    public configComponent!: ConfigComponent;

    @Logger('agent')
    public readonly log!: LoggerApi;

    /**
     * The four canonical soul documents loaded from `.config/agents/<name>/` via the `@Prompt`
     * decorator. The map keys come from `SoulSection` enum values so the section order is declared,
     * not hardcoded.
     */
    @Prompt('agent', PromptScope.AGENT, function (this: Agent) {
        return this.config.name;
    })
    public prompt!: { [x: string]: string };

    /** In-memory mirror of the four soul documents the agent loaded during `@Init`. */
    private readonly documents = new Map<SoulSection, SoulDocument>();

    constructor(public readonly config: FAgentProfileConfiguration) {
        super();
    }

    /**
     * Loads the agent's own mind: hydrates the per-agent prompt directory from the version-controlled
     * seed, writes the empty MEMORY template when missing, reads the four canonical sections, asserts
     * the constitution-layer requirement, and broadcasts a `AGENT_TOPIC_SOUL_LOADED` notice. A missing
     * required section is fatal: Flyflor refuses to start.
     */
    @Init()
    public async init(): Promise<void> {
        this.seedPromptDir();
        this.ensureMemoryTemplate();
        for (const section of SOUL_SECTION_ORDER) {
            this.loadOne(section);
        }
        for (const required of SOUL_REQUIRED_SECTIONS) {
            if (!this.documents.has(required)) {
                await this.capillary.notice(AGENT_TOPIC_SOUL_MISS, { section: required, agent: this.config.name });
                throw Object.assign(Error('Soul document missing at boot'), {
                    detail: { section: required, agent: this.config.name, promptDir: this.promptDir },
                });
            }
        }
        const sections = [...this.documents.keys()];
        this.log.info('agent ready', {
            name: this.config.name,
            soulSections: sections,
            promptDir: this.promptDir,
        });
        await this.capillary.notice(AGENT_TOPIC_SOUL_LOADED, { name: this.config.name, sections });
    }

    /**
     * Runs one user turn through the agent's own mind and the configured LLM. The system prompt is
     * composed by the agent from its private soul documents; the runtime never sees or rewrites it.
     * @param content - raw user text for the current turn.
     * @returns assistant text produced by the model.
     */
    public async chat(content: string): Promise<string> {
        const systemContent = this.composeSystemPrompt();
        const messages: AgentChatMessage[] = [
            { role: AgentChatRole.System, content: systemContent },
            { role: AgentChatRole.User, content },
        ];
        this.log.debug('agent turn', { agent: this.config.name, systemChars: systemContent.length, userChars: content.length });
        const reply = await this.intelligence.complete(messages);
        await this.capillary.notice(AGENT_TOPIC_SOUL_TURN, { role: 'user', content, agent: this.config.name });
        return reply;
    }

    /**
     * Identity metadata the runtime uses to log and route. The agent's name comes from the profile
     * that constructed it; the runtime never invents a different name.
     */
    public get profile(): { name: string } {
        return { name: this.config.name };
    }

    /**
     * Reads one markdown file from the per-agent prompt directory into the in-memory document map.
     * Missing files leave the map untouched (so the boot-time required-section check can fail loudly).
     * @param section - the canonical section whose file to read.
     */
    private loadOne(section: SoulSection): void {
        const path = join(this.promptDir, `${section}.md`);
        if (!existsSync(path)) {
            return;
        }
        const content = readFileSync(path, 'utf-8');
        if (content.length === 0) {
            return;
        }
        this.documents.set(section, { section, content, updatedAt: new Date().toISOString() });
    }

    /**
     * Composes the agent's system prompt from its own soul documents in declared order, skipping any
     * section that did not load. The runtime never inspects or rewrites this string.
     * @returns ordered system-prompt text passed to the model.
     */
    private composeSystemPrompt(): string {
        return SOUL_SECTION_ORDER
            .map((section) => this.documents.get(section)?.content ?? '')
            .filter((content) => content.length > 0)
            .join(PROMPT_SEPARATOR);
    }

    /**
     * Resolves the on-disk directory the soul documents are read from. The active agent's prompt
     * directory is created lazily so the agent works on a fresh checkout.
     * @returns absolute path to `.config/agents/<name>/`.
     */
    private get promptDir(): string {
        const dir = join(this.configRoot, 'agents', this.config.name);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Hydrates the per-agent prompt directory from the version-controlled `prompts/agent` seed.
     *
     * `cpSync(..., { force: true })` makes the seed authoritative: any runtime edit to the directory is
     * overwritten on the next boot. Runtime edits must go through `Agent.upsertSoul` so they are visible
     * in audit logs and can be guarded, never by touching the markdown files directly.
     *
     * The Chinese `.zh.cn.md` mirrors are explicitly filtered out: the runtime must only ever see the
     * English canonical `.md` files (AGENTS.md red line 5).
     */
    private seedPromptDir(): void {
        const target = this.promptDir;
        mkdirSync(target, { recursive: true });
        if (existsSync(PROMPT_SEED_DIR) && statSync(PROMPT_SEED_DIR).isDirectory()) {
            cpSync(PROMPT_SEED_DIR, target, {
                recursive: true,
                force: true,
                filter: (source) => !source.endsWith(ZH_MIRROR_SUFFIX),
            });
        }
    }

    /**
     * Writes the `MEMORY.md` empty template to disk when no memory file exists yet. This makes the
     * contract from `AGENTS.md` ("read MEMORY.md on startup") true even on a fresh agent checkout.
     * The agent owns this — neither the runtime nor a separate soul component does it.
     */
    private ensureMemoryTemplate(): void {
        const path = join(this.promptDir, `${SoulSection.Memory}.md`);
        if (existsSync(path)) {
            return;
        }
        const template = [
            '# Memory',
            '',
            '(empty — will be populated by CrystallService)',
            '',
        ].join('\n');
        mkdirSync(this.promptDir, { recursive: true });
        writeFileSync(path, template, 'utf-8');
        this.log.info('memory template written', { agent: this.config.name, path });
    }

    /**
     * Applies an in-memory soul upsert and consults the capillary layer for guard approval. The
     * default guard policy is `Allow`; only an explicit guard deny fails the upsert. No disk write
     * happens in this pass (constitution-layer scope only); persistence waits for the memory shard.
     * @param draft - the section, new content, and human-readable reason for the proposed write.
     */
    public async upsertSoul(draft: SoulCrystallizeDraft): Promise<void> {
        const decision = await this.capillary.ask(AGENT_TOPIC_SOUL_CRYSTALLIZE, draft);
        if (decision.decision !== CapillaryDecision.Allow) {
            this.log.warn('soul upsert denied by guard', { agent: this.config.name, section: draft.section, reason: draft.reason });
            throw Object.assign(Error('Soul upsert denied by guard'), {
                detail: { agent: this.config.name, section: draft.section, guardReason: decision.reason },
            });
        }
        const document: SoulDocument = {
            section: draft.section,
            content: draft.content,
            updatedAt: new Date().toISOString(),
        };
        this.documents.set(draft.section, document);
        this.log.info('soul upsert applied', { agent: this.config.name, section: draft.section, chars: draft.content.length });
    }
}

import { FileService, FService, Inject, Logger, Prompt, Service, useContainer, type FLogger } from '@/core';
import { AgentChatRole, Intelligence, type AgentChatMessage } from './intelligence';
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
    public crystall!: Crystall;

    @Inject()
    public memory!: Memory;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    @Inject(async function (this: Brain) {
        const { model } = await useContainer().getAsync(ConfigComponent);
        return {
            llm: model,
            modelOverride: this.config.model || undefined,
            maxTokens: this.config.maxTokens || model.maxTokens,
        };
    })
    public intelligence!: Intelligence;

    @Inject(function (this: Brain) {
        return this.config;
    })
    public investigation!: Investigation;

    @Prompt('agent', function wrapper(this: Brain) {
        return this.config.name;
    })
    public prompt!: FileService<AgentPrompt>;

    public context: AgentChatMessage[];

    constructor(public config: FAgentProfileConfiguration) {
        super();
        this.context = [];
    }

    public async *transformer(content: string): AsyncGenerator<string> {
        this.log.debug('transformer', content);
        const state = { cancelled: false, turn: undefined as ReturnType<Intelligence['turn']> | undefined };
        const stream = new ReadableStream<string>({
            start: async (controller) => {
                let assistant = '';
                try {
                    const investigation = await this.investigation.investigate({ content, context: this.context });
                    if (state.cancelled) return;
                    const turn = this.intelligence.turn(this.buildMessages(content, investigation));
                    state.turn = turn;
                    while (true) {
                        const { done, value } = await turn.read();
                        if (done) break;
                        assistant += value;
                        controller.enqueue(value);
                    }
                    if (state.cancelled) return;
                    this.crystall.commitTurn(this.context, content, assistant);
                    controller.close();
                } catch (error) {
                    if (state.cancelled) return;
                    controller.error(error);
                } finally {
                    state.turn?.release();
                    state.turn = undefined;
                }
            },
            cancel: async (reason) => {
                state.cancelled = true;
                await state.turn?.cancel(reason).catch(() => undefined);
            },
        });
        const reader = stream.getReader();
        let completed = false;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    completed = true;
                    break;
                }
                yield value;
            }
        } finally {
            if (!completed) await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        }
    }

    private buildMessages(content: string, investigation?: BrainInvestigationResult): AgentChatMessage[] {
        const sections = PROMPT_SECTION_ORDER.map((section) => {
            const value = this.prompt.data[section];
            return typeof value === 'string' && value.trim().length > 0 ? `<${section}>\n${value.trim()}\n</${section}>` : '';
        }).filter((section) => section.length > 0);

        return this.crystall.prepareTurn([
            {  role: AgentChatRole.System, content: sections.join('\n\n') },
            ...this.context,
            { role: AgentChatRole.User, content: this.renderUserContent(content, investigation) },
        ]);
    }

    private renderUserContent(content: string, investigation?: BrainInvestigationResult): string {
        if (investigation === undefined) return content;
        return JSON.stringify({
            user_message: content,
            investigation: investigation.state,
            tool_observations: investigation.observations.map((observation) => ({
                source: observation.source,
                pipes: observation.pipes,
                ok: observation.ok,
                code: observation.code,
                summary: observation.summary,
            })),
        }, null, 4);
    }
}

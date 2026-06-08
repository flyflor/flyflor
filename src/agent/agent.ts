import { Inject, Provide, Logger, FAgent } from '@/core';
import { Brain } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';
import type { AgentChatMessage } from './brain/intelligence';
import type { BrainInvestigationResult } from './brain/investigation';

interface AgentTurnMemory {
    id: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    userMessage: string;
    investigation?: BrainInvestigationResult;
    messages: AgentChatMessage[];
    chunks: string[];
    assistant: string;
    error?: string;
    startedAt: string;
    completedAt?: string;
}

interface AgentRuntimeMemory {
    turns: AgentTurnMemory[];
}

@Provide()
export class Agent extends FAgent<string> {
    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public brain!: Brain;

    @Inject()
    public config!: ConfigComponent;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    public memory: AgentRuntimeMemory;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
        this.memory = { turns: [] };
    }

    public override async next(data: string): Promise<void> {
        if (!this.hasPreparedTurnApi()) {
            for await (const content of this.brain.transformer(data)) {
                super.next(content);
            }
            return;
        }

        const turn = this.createTurn(data);
        try {
            const prepared = await this.brain.prepareTurn(data);
            turn.investigation = prepared.investigation;
            turn.messages = prepared.messages;
            this.log.info('agent.turn.prepared', {
                id: turn.id,
                messages: turn.messages.length,
                investigationConfidence: turn.investigation.state.confidence,
                observations: turn.investigation.observations.length,
            });
            for await (const content of this.brain.streamTurn(turn.messages)) {
                turn.chunks.push(content);
                turn.assistant += content;
                super.next(content);
            }
            this.brain.commitTurn(data, turn.assistant);
            turn.status = 'completed';
            turn.completedAt = new Date().toISOString();
            this.log.info('agent.turn.complete', {
                id: turn.id,
                chunks: turn.chunks.length,
                assistantLength: turn.assistant.length,
            });
        } catch (error) {
            turn.status = 'failed';
            turn.completedAt = new Date().toISOString();
            turn.error = error instanceof Error ? error.message : String(error);
            this.log.error('agent.turn.error', {
                id: turn.id,
                error: turn.error,
            });
            throw error;
        }
    }

    private createTurn(userMessage: string): AgentTurnMemory {
        const turn: AgentTurnMemory = {
            id: this.memory.turns.length + 1,
            status: 'running',
            userMessage,
            messages: [],
            chunks: [],
            assistant: '',
            startedAt: new Date().toISOString(),
        };
        this.memory.turns.push(turn);
        this.log.info('agent.turn.start', {
            id: turn.id,
            userMessageLength: userMessage.length,
        });
        return turn;
    }

    private hasPreparedTurnApi(): boolean {
        return typeof this.brain.prepareTurn === 'function'
            && typeof this.brain.streamTurn === 'function'
            && typeof this.brain.commitTurn === 'function';
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

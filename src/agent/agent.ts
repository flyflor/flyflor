import { Inject, Provide, Logger, FAgent } from '@/core';
import { Brain } from './brain';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';

interface AgentTurnMemory {
    id: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    userMessage: string;
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
        const turn = this.createTurn(data);
        try {
            for await (const content of this.brain.transformer(data)) {
                turn.chunks.push(content);
                turn.assistant += content;
                super.next(content);
            }
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
}

import { Inject, Provide, Logger, FAgent } from '@/core';
import { Brain, CallosumSignalType, type CallosumSignal } from './brain';
import { Memory, type AgentTurnInput } from './memory';
import type { FLogger } from '@/core/logger';
import type { FAgentProfileConfiguration } from '@/configuration';

export interface AgentTurnResult {
    user: string;
    assistant: string;
    completed: boolean;
}

/**
 * The agent: a person-like runtime object. It owns an injected brain (cortex) and memory (prefrontal
 * cache), and is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * `next()` is only the outward reaction: the brain owns routing, memory use, thinking, and commit.
 */
@Provide()
export class Agent extends FAgent<CallosumSignal> {
    @Inject(function (this: Agent) {
        return [this.agentConfig, this.synapse];
    })
    public memory!: Memory;

    @Inject(function (this: Agent) {
        return [this.agentConfig, this.synapse, this.memory];
    })
    public brain!: Brain;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    public async run(input: AgentTurnInput) {
        this.log.debug('turn.start', input);
    }
}

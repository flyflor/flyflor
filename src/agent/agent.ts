import { Scope, Provide, Logger, FAgent } from '@/core';
import { Brain, type CallosumSignal } from './brain';
import { Memory } from './memory';
import type { FLogger } from '@/core/logger';
import type { FAgentProfileConfiguration } from '@/configuration';
import type { Synapse } from '@/neural';

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
export class Agent extends FAgent<string> {
    @Scope()
    public memory!: Memory;

    @Scope()
    public brain!: Brain;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    constructor(public override agentConfig: FAgentProfileConfiguration, public override synapse: Synapse) {
        super(agentConfig, synapse);
        // this.pipe(this.brain.next.bind(this.brain));
    }
}

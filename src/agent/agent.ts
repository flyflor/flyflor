import { Inject, Provide, Logger, FAgent } from '@/core';
import { Brain, CallosumSignalType, type CallosumSignal } from './brain';
import { Memory, type AgentTurnInput } from './memory';
import { type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';

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
        return [this.agentConfig];
    })
    public memory!: Memory;

    @Inject(function (this: Agent) {
        return [this.agentConfig, this.memory];
    })
    public brain!: Brain;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public async run(input: AgentTurnInput): Promise<AgentTurnResult> {
        this.log.debug('turn.start', input);
        return new Promise<AgentTurnResult>((resolve, reject) => {
            let assistant = '';
            const subscription = this.brain.subscribe({
                next: (signal) => {
                    if (signal.type === CallosumSignalType.Reply) assistant += signal.chunk;
                    if (signal.type === CallosumSignalType.Done) {
                        this.emit(signal);
                        subscription.unsubscribe();
                        resolve({
                            user: input.content,
                            assistant,
                            completed: assistant.trim().length > 0,
                        });
                        return;
                    }
                    this.emit(signal);
                },
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.brain.run(input).catch((error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }
}

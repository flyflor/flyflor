import { Provide, Logger, FAgent, Scope } from '@/core';
import { Brain, CallosumSignalType, type CallosumSignal } from './brain';
import { Memory } from './memory';
import { type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';

/**
 * The agent: a person-like runtime object. It owns an injected brain (cortex) and memory (prefrontal
 * cache), and is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * `next()` is only the outward reaction: the brain owns routing, memory use, thinking, and commit.
 */
@Provide()
export class Agent extends FAgent<CallosumSignal> {
    @Scope()
    public brain!: Brain;

    @Scope()
    public memory!: Memory;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public async run(text: string): Promise<void> {
        this.log.debug('turn.start', text);
        await new Promise<void>((resolve, reject) => {
            const subscription = this.brain.subscribe({
                next: (signal) => {
                    this.emit(signal);
                    if (signal.type === CallosumSignalType.Done) {
                        subscription.unsubscribe();
                        resolve();
                    }
                },
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.brain.run(this.memory.buildMessage(text)).catch((error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }
}

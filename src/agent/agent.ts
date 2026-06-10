import { Inject, Provide, Logger, FAgent } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import type { FLogger } from '@/core/logger';

/**
 * The agent: a person-like runtime object. It owns an injected brain (cortex) and memory (prefrontal
 * cache), and is itself the `Subject` the neural layer subscribes to for streamed output.
 *
 * `next()` is the turn owner: it asks memory for the assembled mental input, streams the brain's
 * reflex out chunk by chunk, and commits the finished turn to memory only on success.
 */
@Provide()
export class Agent extends FAgent<string> {
    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public brain!: Brain;

    @Inject(function (this: Agent) {
        return this.agentConfig;
    })
    public memory!: Memory;

    @Inject()
    public config!: ConfigComponent;

    @Logger(Agent.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    public override async next(text: string): Promise<void> {
        this.log.debug('turn.start', text);
        const input = await this.memory.messages(text);
        // Memory answered the turn itself (e.g. a constitution edit): reply directly, no reflex.
        if (typeof input === 'string') {
            this.log.debug('turn.reply', input);
            this.memory.commit(text, input);
            super.next(input);
            return;
        }
        // Stream the brain reflex out chunk by chunk; commit only once it completes (error/cancel won't).
        this.log.debug('turn.think', input);
        const assistant: string[] = [];
        await new Promise<void>((resolve, reject) => {
            this.brain.transform(input).subscribe({
                next: (signal) => {
                    if (signal.type !== 'delta') return;
                    assistant.push(signal.text);
                    super.next(signal.text);
                },
                error: reject,
                complete: resolve,
            });
        });
        this.log.debug('turn.commit', assistant.join(''));
        this.memory.commit(text, assistant.join(''));
    }
}

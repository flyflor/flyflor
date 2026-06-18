import { Scope, Provide, FAgent, Init, type IObservable } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';

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
export class Agent extends FAgent<string> implements IObservable<string, string> {
    @Scope()
    public memory!: Memory;

    @Scope()
    public brain!: Brain;

    public override async onPipe(data: string) {
        this.log.info('agent received', { data });
        this.brain.next(data);
        return this.brain;
    }
}

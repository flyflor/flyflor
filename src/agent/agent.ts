import { Scope, Provide, FAgent, type IObservable } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';

/**
 * Owns the scoped `Brain` and `Memory` for one active profile.
 * `next()` only hands user input to the scoped brain; routing, research, and reply generation stay there.
 */
@Provide()
export class Agent extends FAgent<string, string> implements IObservable<string, string> {
    @Scope()
    public memory!: Memory;

    @Scope()
    public brain!: Brain;

    public override async onPipe(data: string) {
        this.log.info('agent received', { data });
        this.brain.next(data);
    }
}

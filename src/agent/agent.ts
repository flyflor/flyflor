import { Scope, Provide, FAgent, type IObservable } from '@/core';
import type { Assignment, Outcome } from './types';
import { Brain } from './brain';

@Provide()
export class Agent extends FAgent<string> implements IObservable<string> {
    @Scope()
    public brain!: Brain;

    public override async onPipe(input: string): Promise<void> {
        this.log.info('agent received', { input });
        await this.brain.next(input);
    }

    public async work(assignment: Assignment): Promise<Outcome | undefined> {
        return await this.brain.work(assignment);
    }
}

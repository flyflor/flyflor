import { Scope, Provide, FAgent } from '@/core';
import type { Assignment, Outcome } from './types';
import { Brain } from './brain';

@Provide()
export class Agent extends FAgent<string> {
    @Scope()
    public brain!: Brain;

    public override async receive(input: string): Promise<void> {
        this.log.info('agent received', { input });
        await this.brain.receive(input);
    }

    public async work(assignment: Assignment): Promise<Outcome | undefined> {
        return await this.brain.work(assignment);
    }
}

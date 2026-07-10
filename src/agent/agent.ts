import { Scope, Provide, FAgent } from '@/core';
import type { FAgentProfileConfiguration } from '@/config';
import type { AgentBus, Assignment, Outcome } from './types';
import { Brain } from './brain';

@Provide()
export class Agent extends FAgent<string, FAgentProfileConfiguration, AgentBus> {
    @Scope()
    public brain!: Brain;

    public override async receive(input: string): Promise<void> {
        this.log.info('agent received', { input });
        await this.brain.receive(input);
    }

    public async work(assignment: Assignment): Promise<Outcome | undefined> {
        return await this.brain.work(assignment);
    }

    public async think(system: string, input: string): Promise<string> {
        return this.brain.think(system, input);
    }
}

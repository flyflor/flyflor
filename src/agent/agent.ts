import type { AgentContext } from '@/collective/context';
import { FAgent, Provide, Scope } from '@/core';
import type { AgentReport, AgentRunControl } from './types';
import { Brain } from './brain';

/**
 * EN: One fixed person in the collective. The manager constructs it once per process.
 * ZH: 群体中的一个固定成员；Manager 在每个进程中只构建一次。
 */
@Provide()
export class Agent extends FAgent<AgentContext, AgentReport> {
    @Scope()
    public brain!: Brain;

    public async run(context: AgentContext, control: AgentRunControl): Promise<AgentReport> {
        return await this.brain.run(context, control);
    }

    public memory() {
        return this.brain.memorySnapshot();
    }
}

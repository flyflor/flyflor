import { Intelligence, type AgentMemory } from '@/agent/brain/intelligence';
import { FAgentAtom, Inject, Logger, Provide, Service, type FLogger } from '@/core';
import { EnvironmentService } from '@/core/environment';
import { ToolExecutor, ToolRegistry } from '@/core/tool';

@Provide()
export class Execution extends FAgentAtom {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public environment!: EnvironmentService;

    @Inject()
    public tools!: ToolRegistry;

    @Inject()
    public executor!: ToolExecutor;

    @Logger(Execution.name)
    public readonly log!: FLogger;

    public async run(messages: AgentMemory[]) {
    }
}

import { FModule, Init, Inject, Module } from '@/core';
import { ToolsModule } from '@/tools';
import { IPCService } from './neural/ipc';
import { Synapse } from '@/neural';

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies,
 * IPC, and the tools boundary (the agent's computer-control hands). The runtime itself is the master
 * agent's orchestrator; the agent is constructed by the runtime via `Synapse.init` and is not a module
 * import (convention > configuration: `listModule(FAgent)` is the discovery surface for agents).
 */
@Module({
    imports: [ToolsModule],
})
export class AppModule extends FModule {
    @Inject()
    public ipc!: IPCService;

    @Inject()
    public synapse!: Synapse;
}

import { FModule, Init, Inject, Module } from '@/core';
import { PluginModule } from '@/plugins';
import { IPCService } from './neural/ipc';
import { Synapse } from '@/neural';

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies,
 * IPC, and the external plugin boundary (skills + MCP). The runtime itself is the master agent's
 * orchestrator; the agent is constructed by the runtime via `Runtime.spawn` and is not a module
 * import (convention > configuration: `listModule(FAgent)` is the discovery surface for agents).
 */
@Module({
    imports: [PluginModule],
})
export class AppModule extends FModule {
    @Inject()
    public ipc!: IPCService;

    @Inject()
    public synapse!: Synapse;
}

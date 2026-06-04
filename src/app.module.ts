import { FModule, Init, Inject, Module, Runtime } from '@/core';
import { CapillaryModule } from '@/capillary';
import { ShardModule } from '@/shard/module';
import { PluginModule } from '@/plugins';

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies,
 * IPC, and the external plugin boundary (skills + MCP). The runtime itself is the master agent's
 * orchestrator; the agent is constructed by the runtime via `Runtime.spawn` and is not a module
 * import (convention > configuration: `listModule(FAgent)` is the discovery surface for agents).
 */
@Module({
    imports: [ShardModule, CapillaryModule, PluginModule],
})
export class AppModule extends FModule {
    @Inject()
    public runtime!: Runtime;
}

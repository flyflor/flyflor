import { FModule, Module } from '@/core';
import { PluginModule } from '@/plugins';
import { Synapse } from '@/neural';

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies,
 * IPC, and the external plugin boundary (skills + MCP). The runtime itself is the master agent's
 * orchestrator; the agent is constructed by the runtime via `Runtime.spawn` and is not a module
 * import (convention > configuration: `listModule(FAgent)` is the discovery surface for agents).
 */
@Module({
    imports: [Synapse, PluginModule],
})
/**
 * EN: AppModule class declaration.
 * ZH: AppModule class 声明。
 */
export class AppModule extends FModule {}

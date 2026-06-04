import { FModule, Init, Inject, Module } from '@/core';
import { ShardModule } from '@/shard/module';
import { PluginModule } from '@/plugins';
import { NeuralTransformer } from './neural';
import { IPCService } from './neural/ipc';

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies,
 * IPC, and the external plugin boundary (skills + MCP). The runtime itself is the master agent's
 * orchestrator; the agent is constructed by the runtime via `Runtime.spawn` and is not a module
 * import (convention > configuration: `listModule(FAgent)` is the discovery surface for agents).
 */
@Module({
    imports: [IPCService, ShardModule, PluginModule],
})
export class AppModule extends FModule {

    @Inject()
    public neural!: NeuralTransformer;

    constructor(public ipc: IPCService) {
        super();
    }

    @Init()
    public async init() {
        await this.ipc.startSocket(this.neural);
    }
}

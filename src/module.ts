import { FModule, Module, Inject } from "@/core";
import { CapillaryModule } from "@/capillary";
import { GuardModule } from "@/guard";
import { IPCModule } from "@/capillary/ipc";
import { ShardModule } from "@/shard/module.ts";
import { PluginModule } from "@/plugins";

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies, IPC,
 * and the external plugin boundary (skills + MCP). Bootstrap resolves this, building the whole DI tree.
 */
@Module({
    imports: [ShardModule, CapillaryModule, GuardModule, IPCModule, PluginModule],
})
export class AppModule extends FModule {
    @Inject() private readonly ipc!: IPCModule;

    /** The IPC socket endpoint, delegated from IPCModule after it initializes (satisfies FlyflorRoot). */
    public get endpoint(): string {
        return this.ipc.endpoint;
    }
}

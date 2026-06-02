import { FModule, Module, Inject } from "@/core";
import { CapillaryModule } from "@/capillary";
import { GuardModule } from "@/guard";
import { IPCModule } from "@/capillary/ipc";
import { ShardModule } from "@/shard/module.ts";

/**
 * The root Flyflor module.
 * Wires the capillary blood-vessel layer, IPC boundary, guard policies, and the state shard (config/memory/context).
 * Bootstrap resolves this, which transitively brings the socket online and exposes the IPC endpoint.
 */
@Module({
    imports: [ShardModule, CapillaryModule, GuardModule, IPCModule],
    exports: [CapillaryModule, IPCModule],
})
export class AppModule extends FModule {
    @Inject() private readonly ipc!: IPCModule;

    /** The IPC socket endpoint, delegated from IPCModule after it initializes (satisfies FlyflorRoot). */
    public get endpoint(): string {
        return this.ipc.endpoint;
    }
}

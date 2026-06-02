import { FModule, Module, Inject } from "@/core";
import { CapillaryModule } from "@/capillary";
import { GuardModule } from "@/guard";
import { IPCModule } from "@/capillary/ipc";
import { ShardModule } from "@/shard/module.ts";

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies, and IPC.
 * Bootstrap resolves this, building the whole DI tree and bringing the socket online.
 */
@Module({
    imports: [ShardModule, CapillaryModule, GuardModule, IPCModule],
})
export class AppModule extends FModule {
    @Inject() private readonly ipc!: IPCModule;

    /** The IPC socket endpoint, delegated from IPCModule after it initializes (satisfies FlyflorRoot). */
    public get endpoint(): string {
        return this.ipc.endpoint;
    }
}

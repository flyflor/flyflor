import { FModule, Module } from "@/core";
import { CapillaryModule } from "@/capillary";
import { ShardModule } from "@/shard/module.ts";
import { PluginModule } from "@/plugins";
import { AgentModule } from "@/agent";

/**
 * The root Flyflor module.
 * Imports the state shard (config/memory/context), the capillary blood-vessel layer, guard policies, IPC,
 * and the external plugin boundary (skills + MCP). Bootstrap resolves this, building the whole DI tree.
 */
@Module({
    imports: [ShardModule, CapillaryModule, AgentModule, PluginModule],
})
export class AppModule extends FModule {}

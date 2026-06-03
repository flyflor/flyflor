import { FModule, Init, Inject, Module } from "@/core";
import type { ConfigComponent } from "@/shard/components";

/**
 * The default agent module.
 *
 * It wires the current single-agent runtime: shared shard state, OpenAI-compatible LLM access, direct routing,
 * and the cluster worker facade used by IPC.
 */
@Module()
export class AgentModule extends FModule {
    @Inject()
    public config!: ConfigComponent;

    @Init()
    public async init() {
        console.log("AgentModule init ...");
    }
}

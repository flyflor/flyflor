import { Module } from "../di";
import { ContextModule } from "../context";
import { MemoryModule } from "../memory";
import { BrainModule } from "../brain";
import { PluginModule } from "../plugins";
import { SignalModule } from "../signal";
import { ToolModule } from "../tools";
import { AgentRuntimeService } from "./agent.runtime.service";

/**
 * Assembles the Flyflor agent kernel runtime.
 *
 * @usage Socket and CLI entrypoints import this module to access AgentRuntimeService.
 */
@Module({
  imports: [ContextModule, MemoryModule, BrainModule, PluginModule, SignalModule, ToolModule],
  providers: [AgentRuntimeService],
  exports: [AgentRuntimeService],
})
export class KernelModule {}

import { Module } from "../di";
import { ContextModule } from "../context";
import { MemoryModule } from "../memory";
import { SignalModule } from "../signal";
import { ToolModule } from "../tools";
import { AgentRuntimeService } from "./agent-runtime.service";
import { MockModelProvider } from "./model-provider";

/**
 * Assembles the Flyflor agent kernel runtime.
 *
 * @usage Socket and CLI entrypoints import this module to access AgentRuntimeService.
 */
@Module({
  imports: [ContextModule, MemoryModule, SignalModule, ToolModule],
  providers: [AgentRuntimeService, MockModelProvider],
  exports: [AgentRuntimeService, MockModelProvider],
})
export class KernelModule {}

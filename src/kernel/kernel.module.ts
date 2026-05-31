import { Module } from "../di";
import { ContextModule } from "../context";
import { MemoryModule } from "../memory";
import { BrainModule } from "../brain";
import { PluginModule } from "../plugins";
import { PromptsModule } from "../prompts";
import { WorkerModule } from "../worker";
import { SandboxModule } from "../sandbox";
import { ScopeModule } from "../scope";
import { CrystalModule } from "../crystal";
import { ForgettingModule } from "../forgetting";
import { SignalModule } from "../signal";
import { ToolModule } from "../tools";
import { AgentRuntimeService } from "./agent.runtime.service";

/**
 * Assembles the Flyflor agent kernel runtime.
 *
 * @usage Socket and CLI entrypoints import this module to access AgentRuntimeService.
 */
@Module({
  imports: [ContextModule, MemoryModule, BrainModule, PluginModule, PromptsModule, WorkerModule, SandboxModule, ScopeModule, CrystalModule, ForgettingModule, SignalModule, ToolModule],
  providers: [AgentRuntimeService],
  exports: [AgentRuntimeService],
})
export class KernelModule {}

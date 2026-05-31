import { Module } from "../di";
import { BrainModule } from "../brain";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory";
import { PromptsModule } from "../prompts";
import { SignalModule } from "../signal";
import { ToolModule } from "../tools";
import { WorkerService } from "./worker.service";

/**
 * Assembles the multi-agent worker system.
 *
 * @usage KernelModule imports this module so workers can be spawned for exploration, discussion, investigation, and coding.
 */
@Module({
  imports: [BrainModule, ConfigModule, MemoryModule, PromptsModule, SignalModule, ToolModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}

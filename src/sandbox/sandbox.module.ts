import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory/memory.module";
import { SignalModule } from "../signal/signal.module";
import { ToolModule } from "../tools/tool.module";
import { SandboxGuard } from "./sandbox.guard.service";

/**
 * Assembles sandbox guard providers and their runtime dependencies.
 */
@Module({
  imports: [SignalModule, ConfigModule, MemoryModule, ToolModule],
  providers: [SandboxGuard],
  exports: [SandboxGuard],
})
export class SandboxModule {}

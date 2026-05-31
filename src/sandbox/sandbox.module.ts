import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory/memory.module";
import { SignalModule } from "../signal/signal.module";
import { SandboxGuard } from "./sandbox.guard.service";

/**
 * Assembles sandbox guard providers and their runtime dependencies.
 */
@Module({
  imports: [SignalModule, ConfigModule, MemoryModule],
  providers: [SandboxGuard],
  exports: [SandboxGuard],
})
export class SandboxModule {}

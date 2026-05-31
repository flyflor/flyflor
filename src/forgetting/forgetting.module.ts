import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { CrystalModule } from "../crystal/crystal.module";
import { MemoryModule } from "../memory/memory.module";
import { SignalModule } from "../signal/signal.module";
import { ForgettingService } from "./forgetting.service";

/**
 * Assembles the forgetting system providers.
 *
 * Imports MemoryModule for chunk/fact operations, SignalModule for
 * runtime coordination, ConfigModule for cycle intervals, and
 * CrystalModule for gem drift.
 *
 * @usage Kernel or root modules import this to enable automatic
 * memory decay and forgetting semantics.
 */
@Module({
  imports: [MemoryModule, SignalModule, ConfigModule, CrystalModule],
  providers: [ForgettingService],
  exports: [ForgettingService],
})
export class ForgettingModule {}

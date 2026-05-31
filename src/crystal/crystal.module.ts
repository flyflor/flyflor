import { Module } from "../di";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory/memory.module";
import { SignalModule } from "../signal/signal.module";
import { CrystalStore } from "./crystal.store.component";
import { CrystalService } from "./crystal.service";

/**
 * Assembles the crystallization decision-learning providers.
 *
 * CrystalModule wires the CrystalStore (crystal.db persistence) and
 * CrystalService (ASK lifecycle, Gem matching, EQ adjustment) together
 * with their dependencies.  The SandboxModule is an optional import;
 * CrystalService listens to {@code sandbox.escalated} signals but does
 * not break when the sandbox layer is absent.
 *
 * @usage Kernel or root modules import this to enable crystal-based
 * decision-pattern learning across conversations.
 */
@Module({
  imports: [MemoryModule, SignalModule, ConfigModule],
  providers: [CrystalStore, CrystalService],
  exports: [CrystalStore, CrystalService],
})
export class CrystalModule {}

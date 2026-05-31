import { Module } from "../di";
import { BrainModule } from "../brain";
import { ConfigModule } from "../config/config.module";
import { MemoryModule } from "../memory/memory.module";
import { SignalModule } from "../signal/signal.module";
import { ToolModule } from "../tools/tool.module";
import { SandboxGuard } from "./sandbox.guard.service";
import { GuardCoordinatorComponent } from "./guard.coordinator.component";
import { WorkspaceAllowlistComponent } from "./workspace.allowlist.component";

/**
 * Assembles sandbox guard providers and their runtime dependencies.
 *
 * @usage `bootstrap` eagerly resolves the guard and coordinator so their
 * `@Subscribe` handlers are attached on the real `--serve` path — without it,
 * `guard.ask` has no responder and mutating tools would never be gated.
 */
@Module({
  imports: [SignalModule, ConfigModule, MemoryModule, BrainModule, ToolModule],
  providers: [SandboxGuard, GuardCoordinatorComponent, WorkspaceAllowlistComponent],
  exports: [SandboxGuard, WorkspaceAllowlistComponent],
  bootstrap: [SandboxGuard, GuardCoordinatorComponent],
})
export class SandboxModule {}

import { createContainer, Container } from "../../src/di";
import { ConfigService } from "../../src/config/config.service";
import { KernelModule } from "../../src/kernel/kernel.module";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";

/**
 * Creates a DI container with a custom ConfigService instance registered
 * and all kernel module providers available. Tests that need multiple
 * services from the same container should use this, then resolve
 * individual services.
 *
 * Usage:
 *   const config = new ConfigService(profile.root, profile.configPath);
 *   const ctx = createTestContext(config);
 *   const runtime = ctx.runtime;
 *   const memory = ctx.memory;
 */
export interface TestContext {
  readonly container: Container;
  readonly config: ConfigService;
  readonly runtime: AgentRuntimeService;
  readonly memory: MemoryComponent;
  readonly signalBus: SignalBus;
}

export function createTestContext(config: ConfigService): TestContext {
  const container = createContainer(KernelModule, config.getProjectRoot());
  container.registerInstance(ConfigService, config);
  const runtime = container.resolve(AgentRuntimeService);
  const memory = container.resolve(MemoryComponent);
  const signalBus = container.resolve(SignalBus);
  return { container, config, runtime, memory, signalBus };
}

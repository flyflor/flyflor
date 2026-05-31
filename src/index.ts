import type { RuntimeStatus } from "./shared/runtime";
import { createContainer } from "./di";
import { SocketModule, SocketServerService } from "./socket";

/**
 * Creates the minimal startup status for the current runtime entrypoint.
 *
 * @returns Runtime status that confirms the project skeleton can start.
 * @usage CLI startup reports this before either printing status or serving sockets.
 */
export function createRuntimeStatus(): RuntimeStatus {
  return {
    name: "flyflor",
    status: "runtime-ready",
    configPath: "./.config/config.jsonc",
  };
}

const status = createRuntimeStatus();

if (Bun.argv.includes("--serve")) {
  const container = createContainer(SocketModule);
  const service = container.resolve(SocketServerService);
  const server = service.start();
  console.log(`[${status.name}] socket-ready url=http://${server.hostname}:${server.port}`);
} else {
  console.log(`[${status.name}] ${status.status} config=${status.configPath}`);
}

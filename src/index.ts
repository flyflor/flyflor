import type { RuntimeStatus } from "./shared/runtime";
import { SocketServerService } from "./socket";

/**
 * Creates the minimal startup status for the current thin entrypoint.
 *
 * @returns Runtime status that confirms the project skeleton can start.
 * @usage This composition API is intentionally thin until the DI container bootstrap is implemented.
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
  const service = new SocketServerService();
  const server = service.start();
  console.log(`[${status.name}] socket-ready url=http://${server.hostname}:${server.port}`);
} else {
  console.log(`[${status.name}] ${status.status} config=${status.configPath}`);
}

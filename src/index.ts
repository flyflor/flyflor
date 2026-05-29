import type { RuntimeStatus } from "./shared/runtime";

/**
 * Creates the minimal startup status for the current thin entrypoint.
 *
 * @returns Runtime status that confirms the project skeleton can start.
 * @usage This composition API is intentionally thin until the DI container bootstrap is implemented.
 */
export function createRuntimeStatus(): RuntimeStatus {
  return {
    name: "flyflor",
    status: "red-lines-ready",
    configPath: "./.config/config.jsonc",
  };
}

const status = createRuntimeStatus();

console.log(`[${status.name}] ${status.status} config=${status.configPath}`);

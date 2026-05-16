/**
 * Compatibility export for the old runtime path.
 *
 * Dream is now owned by `src/neural/memory` because it mutates long-term memory
 * graph state. Runtime code should import from the neural boundary directly.
 */

export * from "../../neural/memory/dream.worker.ts";

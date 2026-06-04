import { Runtime } from '../runtime';

/**
 * Returns the container-resolved runtime.
 * Reflect-metadata injection already builds and initializes `Runtime` itself; this composable
 * simply names the dependency for call sites that prefer a `useXxx()` accessor.
 * @param runtime - the injected runtime.
 * @returns the same runtime, ready to `chat` once `@Init` has run.
 */
export function useRuntime(runtime: Runtime): Runtime {
    return runtime;
}

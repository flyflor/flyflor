import { createContainer } from "./container.ts";
import type { Container } from "./container.ts";
import { getModuleMetadata } from "../decorators.ts";
import type { Ctor } from "../decorators.ts";
import type { FModule } from "./superclz.ts";

/**
 * Contract a root module fulfils so the bootstrap can report the live IPC endpoint after startup.
 * `endpoint` is the resolved socket address (e.g. `./flyflor.sock`) the kernel is listening on.
 */
export interface FlyflorRoot {
    readonly endpoint: string;
}

/**
 * Bootstraps the Flyflor kernel from a root `@Module`.
 *
 * It is the composition root: it registers the reachable module graph, then resolves and initializes the root,
 * which transitively brings the capillary layer, guards, config, and the IPC socket online.
 */
export class Factory {
    /**
     * Builds the container, registers the `@Module` graph reachable from `rootModule`, and starts the kernel.
     * @param rootModule - the application root module class (must expose the IPC `endpoint`).
     * @returns the socket endpoint the kernel is listening on, for the entry file to log.
     */
    public static async create(rootModule: Ctor<FModule & FlyflorRoot>): Promise<string> {
        const container = createContainer();
        Factory.registerGraph(container, rootModule, new Set<Ctor>());
        const root = await container.getAsync(rootModule);
        return root.endpoint;
    }

    /**
     * Recursively registers a module and everything it imports/provides/exports so `listModule` can scan it.
     * Construction stays lazy — this only records constructors.
     * @param container - the container receiving registrations.
     * @param ctor - the current class to register.
     * @param visited - cycle guard for the module graph.
     */
    private static registerGraph(container: Container, ctor: Ctor, visited: Set<Ctor>): void {
        if (visited.has(ctor)) {
            return;
        }
        visited.add(ctor);
        container.register(ctor);
        const metadata = getModuleMetadata(ctor);
        if (metadata === undefined) {
            return; // a leaf injectable (service/component/repo) — nothing further to walk
        }
        const references = [
            ...(metadata.imports ?? []),
            ...(metadata.providers ?? []),
            ...(metadata.exports ?? []),
        ];
        for (const reference of references) {
            Factory.registerGraph(container, reference, visited);
        }
    }
}

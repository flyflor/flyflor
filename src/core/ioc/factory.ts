import { createContainer } from "./container.ts";
import { Container } from "./container.ts";
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

/** The container built by the most recent `Factory.create`, exposed via `useContainer()`. */
let activeContainer: Container | undefined;

/**
 * Returns the active DI container, for code outside the injection graph that needs `getAsync` / `listModule`.
 * @returns the container created by the last `Factory.create`.
 */
export function useContainer(): Container {
    if (activeContainer === undefined) {
        throw new Error("Container not initialized — call Factory.create first");
    }
    return activeContainer;
}

/**
 * Bootstraps the Flyflor kernel from a root `@Module`.
 *
 * It is the composition root: it registers the import graph, then eagerly builds and initializes the whole
 * DI tree (every node is a shared singleton). Dependencies are initialized before dependents via `getAsync`.
 */
export class Factory {
    /**
     * Builds the container, registers the `@Module` import graph, brings the whole DI tree online, and returns
     * the root's IPC endpoint.
     * @param rootModule - the application root module class (must expose the IPC `endpoint`).
     * @returns the socket endpoint the kernel is listening on.
     */
    public static async create(rootModule: Ctor<FModule & FlyflorRoot>): Promise<string> {
        const container = createContainer();
        activeContainer = container;
        Factory.registerGraph(container, rootModule, new Set<Ctor>());

        // Eagerly build + initialize the entire DI tree; getAsync orders dependencies before dependents.
        for (const ctor of container.listRegistered()) {
            await container.getAsync(ctor);
        }

        const root = container.get(rootModule);
        return root.endpoint;
    }

    /**
     * Recursively registers a module and everything it `imports` so the DI tree is complete before boot.
     * Construction stays lazy — this only records constructors. Leaf imports (services/components/repos/guards)
     * have no module metadata and simply register themselves; modules recurse into their own imports.
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
            return; // a leaf injectable — nothing further to walk
        }
        for (const reference of metadata.imports ?? []) {
            Factory.registerGraph(container, reference, visited);
        }
    }
}

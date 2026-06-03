import { useContainer } from "./ioc/container.ts";
import type { Ctor } from "./decorators.ts";
import type { FModule } from "./ioc/superclz.ts";

/**
 * Bootstraps the Flyflor kernel from a root `@Module`.
 *
 * It is the composition root: it registers the import graph, then eagerly builds and initializes the whole
 * DI tree (every node is a shared singleton). Dependencies are initialized before dependents via `getAsync`.
 */
export class Factory {
    /**
     * Builds and initializes a root module that does not expose an external endpoint, such as an agent worker.
     * @param rootModule - the application or worker root module class.
     * @returns the initialized root module instance.
     */
    public static async create<T extends Ctor<FModule>>(rootModule: T) {
        const container = useContainer();
        return container.getAsync(rootModule);
    }
}

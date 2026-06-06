import { useContainer } from './ioc';
const container = useContainer();

import type { Ctor } from './decorator';
import type { FModule } from './ioc';

/**
 * Bootstraps the Flyflor kernel from a root `@Module`.
 *
 * It is the composition root: it registers the import graph, then eagerly builds and initializes the root module.
 * `getAsync` decides reuse from decorator metadata: singleton classes are cached, ordinary providers are fresh.
 */
export class Factory {
    /**
     * Builds and initializes a root module that does not expose an external endpoint, such as an agent worker.
     * @param rootModule - the application or worker root module class.
     * @returns the initialized root module instance.
     */
    public static async create<T extends Ctor<FModule>>(rootModule: T) {
        return container.getAsync(rootModule);
    }
}

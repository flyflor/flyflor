import { useContainer } from './ioc';
import type { Ctor } from './decorator';
import type { Container, FModule } from './ioc';
import { Synapse } from '@/neural/synapse';

/**
 * Bootstraps the Flyflor kernel from a root `@Module`.
 *
 * It is the composition root: it registers the import graph, then eagerly builds and initializes the root module.
 * `getAsync` decides reuse from decorator metadata: singleton classes are cached, ordinary providers are fresh.
 */
export interface Factory extends Container {}

export class Factory {
    constructor(public container: Container) {
        return new Proxy(this, {
            get: (target, key, receiver) => {
                const value = Reflect.get(target, key, receiver) ?? Reflect.get(container, key, container);
                return typeof value === 'function' && !(key in target) ? value.bind(container) : value;
            },
            set: (target, key, value, receiver) => Reflect.set(target, key, value, receiver),
        });
    }

    /**
     * Builds and initializes a root module that does not expose an external endpoint, such as an agent worker.
     * @param rootModule - the application or worker root module class.
     * @returns the initialized root module instance.
     */
    public static async create<T extends Ctor<FModule>>(rootModule: T) {
        const container = useContainer();
        const factory = new Factory(container);
        await container.getAsync(rootModule);
        return factory;
    }

    public async synapse() {
        return await this.container.getAsync(Synapse);
    }
}

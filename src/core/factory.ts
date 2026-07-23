import { useContainer } from './ioc';
import type { Ctor } from './decorator';
import type { Container, FModule } from './ioc';

/**
 * EN: Bootstraps the Flyflor kernel from a root `@Module`.
 * ZH: 从根 `@Module` 启动 Flyflor kernel。
 *
 * EN: It is the composition root: it registers the import graph, then eagerly builds and initializes the root
 * module. `getAsync` decides reuse from decorator metadata.
 * ZH: 它是 composition root：注册 import graph，然后提前构建并初始化根 module。`getAsync` 根据 decorator metadata 决定复用策略。
 */
export interface Factory extends Container {}

/**
 * EN: Proxy wrapper that exposes the IOC container plus Flyflor bootstrap helpers.
 * ZH: 暴露 IOC container 与 Flyflor 启动 helper 的代理包装对象。
 */
export class Factory {
    /**
     * EN: Creates a proxy that forwards unknown properties to the underlying container.
     * ZH: 创建一个会把未知属性转发到底层 container 的代理。
     */
    constructor(
        /** EN: Underlying IOC container this factory proxies. ZH: 当前 factory 代理的底层 IOC container。 */
        public container: Container,
    ) {
        return new Proxy(this, {
            get: (target, key, receiver) => {
                const value = Reflect.get(target, key, receiver) ?? Reflect.get(container, key, container);
                return typeof value === 'function' && !(key in target) ? value.bind(container) : value;
            },
            set: (target, key, value, receiver) => Reflect.set(target, key, value, receiver),
        });
    }

    /**
     * EN: Builds and initializes the root application module.
     * ZH: 构建并初始化根应用 module。
     */
    public static async create<T extends Ctor<FModule>>(rootModule: T) {
        const container = useContainer();
        const factory = new Factory(container);
        await container.getAsync(rootModule);
        return factory;
    }

    /**
     * EN: Returns the initialized global `Synapse`.
     * ZH: 返回已初始化的全局 `Synapse`。
     */
    public async synapse() {
        const { Synapse } = await import('@/neural/synapse');
        return await this.container.getAsync(Synapse);
    }
}

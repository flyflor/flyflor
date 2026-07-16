import {
    INIT_METADATA_KEY,
    INJECT_METADATA_INSTANCE_KEY,
    INJECT_METADATA_KEY,
    MODULE_METADATA_KEY,
    PROVIDER_SINGLETON_KEY,
    type InjectInstanceMetadata,
    type InjectMetadata,
} from './ioc/types';
import { useContainer } from './ioc/container';
import type { FModule } from './ioc/abstracts';
import { get } from 'lodash-es';
import { join } from 'node:path';

/**
 * ZH: decorators 和 factory helpers 可接受的具体构造器。
 * EN: Concrete constructor accepted by decorators and factory helpers.
 */
export type Ctor<T = unknown> = new (...args: never[]) => T;

/**
 * ZH: 类型边界使用的抽象构造器形态。
 * EN: Abstract constructor shape for type-only boundaries.
 */
export type AbstractCtor<T = unknown> = abstract new (...args: never[]) => T;

/**
 * ZH: `@Module({ imports })` 中使用的类引用。
 * EN: Class reference used in `@Module({ imports })`.
 */
export type ModuleReference = Ctor;

/**
 * ZH: `@Module` 接受的元数据。
 *
 * ZH: `imports` 描述当前 module 的 DI 子树必须可达的类。
 * EN: Metadata accepted by `@Module`.
 * EN: `imports` describes classes that must be reachable from the module's DI subtree.
 */
export interface ModuleMetadata {
    imports?: ModuleReference[];
}

/**
 * ZH: 将类标记为 IOC provider，但不做 singleton 缓存。
 * EN: Marks a class as an IOC provider without singleton caching.
 */
export function Provide(): ClassDecorator {
    return (target) => { }
}

/**
 * ZH: 将 provider 类标记为缓存在 IOC singleton map 中。
 * EN: Marks a provider class as cached in the IOC singleton map.
 */
export function Singleton(): ClassDecorator {
    return (target) => Reflect.defineMetadata(PROVIDER_SINGLETON_KEY, true, target);
}

/**
 * ZH: 标记 module 边界并记录它的 import graph。
 * EN: Marks a module boundary and records its import graph.
 */
export function Module<T extends FModule>(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => {
        Singleton()(target);
        Reflect.defineMetadata(MODULE_METADATA_KEY, metadata, target);
    };
}

/**
 * ZH: 按 reflected design type 注入属性。
 * EN: Injects a property by reflected design type.
 */
export function Inject(): PropertyDecorator;
/**
 * ZH: 登记一个属性键，其依赖类型在解析时从反射元数据读取。
 * EN: Registers one property key whose dependency type is read from reflected metadata at resolution time.
 */
export function Inject(): PropertyDecorator {
    return (target, propertyKey) => registerInject(target, propertyKey, false);
}

/**
 * ZH: 使用当前 host scope 中的值注入类。
 * EN: Injects a class using values from the current host scope.
 */
export function Scope(): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerInject(target, propertyKey, true);
    };
}

/**
 * ZH: 在 host 构造器上保存一条属性注入元数据。
 * EN: Stores one property-injection metadata record on the host constructor.
 */
function registerInject(
    target: object,
    propertyKey: string | symbol,
    scoped: boolean,
): void {
    const owner = target.constructor;
    const own = Reflect.getOwnMetadata(INJECT_METADATA_KEY, owner) as InjectMetadata[] | undefined;
    const data = (own || []).filter((inject) => inject.propertyKey !== propertyKey);
    Reflect.defineMetadata(INJECT_METADATA_KEY, [...data, { propertyKey, scoped }], owner);
}

/**
 * ZH: 标记一个在 IOC 注入后运行的生命周期方法。
 * EN: Marks one lifecycle method to run after IOC injection.
 */
export function Init(): MethodDecorator {
    return (target, propertyKey) => Reflect.defineMetadata(INIT_METADATA_KEY, propertyKey, target);
}

/**
 * ZH: 注入 `ConfigService`，并可选择暴露一个嵌套配置键。
 * EN: Injects `ConfigService`, optionally exposing one nested config key.
 */
export function Config(key?: string): PropertyDecorator {
    return (target, propertyKey) => {
        const configStorageKey = Symbol(String(propertyKey));
        const owner = target.constructor;
        const own = Reflect.getOwnMetadata(INJECT_METADATA_INSTANCE_KEY, owner) as InjectInstanceMetadata[] | undefined;
        const data = (own || []).filter((inject) => inject.propertyKey !== propertyKey);
        Reflect.defineMetadata(INJECT_METADATA_INSTANCE_KEY, [...data, {
            propertyKey,
            instance: async () => {
                const { ConfigService } = await import('@/config');
                return useContainer().getAsync(ConfigService);
            },
        }], owner);
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: true,
            get() {
                const config = this[configStorageKey];
                if (!key) return config;
                return get(config, key);
            },
            set(value) {
                this[configStorageKey] = value;
            },
        });
    }
}

/**
 * ZH: 从仓库根目录按约定解析并注入 prompt 文件或目录。
 * EN: Injects a canonical prompt file or directory resolved from the repository root.
 */
export function Prompt<TThis = object>(path: string | ((this: TThis, prop: TThis) => string)): PropertyDecorator {
    return (target, propertyKey) => {
        const promptStorageKey = Symbol(String(propertyKey));
        const owner = target.constructor;
        const own = Reflect.getOwnMetadata(INJECT_METADATA_INSTANCE_KEY, owner) as InjectInstanceMetadata[] | undefined;
        const data = (own || []).filter((inject) => inject.propertyKey !== propertyKey);
        Reflect.defineMetadata(INJECT_METADATA_INSTANCE_KEY, [...data, {
            propertyKey,
            instance: async function (this: TThis) {
                const [{ useRootPath }, { PromptService }] = await Promise.all([
                    import('@/config'),
                    import('@/prompt/service'),
                ]);
                const promptPath = join(useRootPath(), typeof path === 'function' ? path.call(this, this) : path);
                return useContainer().getAsync(PromptService, promptPath);
            },
        }], owner);
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: true,
            get() {
                return this[promptStorageKey];
            },
            set(value) {
                this[promptStorageKey] = value;
            },
        });
    };
}

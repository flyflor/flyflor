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
 * EN: Concrete constructor accepted by decorators and factory helpers.
 * ZH: decorators 和 factory helpers 可接受的具体构造器。
 */
export type Ctor<T = unknown> = new (...args: never[]) => T;

/**
 * EN: Abstract constructor shape for type-only boundaries.
 * ZH: 类型边界使用的抽象构造器形态。
 */
export type AbstractCtor<T = unknown> = abstract new (...args: never[]) => T;

/**
 * EN: Class reference used in `@Module({ imports })`.
 * ZH: `@Module({ imports })` 中使用的类引用。
 */
export type ModuleReference = Ctor;

/**
 * EN: Metadata accepted by `@Module`.
 * ZH: `@Module` 接受的元数据。
 *
 * EN: `imports` describes classes that must be reachable from the module's DI subtree.
 * ZH: `imports` 描述当前 module 的 DI 子树必须可达的类。
 */
export interface ModuleMetadata {
    imports?: ModuleReference[];
}

/**
 * EN: Marks a class as an IOC provider without singleton caching.
 * ZH: 将类标记为 IOC provider，但不做 singleton 缓存。
 */
export function Provide(): ClassDecorator {
    return (target) => { }
}

/**
 * EN: Marks a provider class as cached in the IOC singleton map.
 * ZH: 将 provider 类标记为缓存在 IOC singleton map 中。
 */
export function Singleton(): ClassDecorator {
    return (target) => Reflect.defineMetadata(PROVIDER_SINGLETON_KEY, true, target);
}

/**
 * EN: Marks a module boundary and records its import graph.
 * ZH: 标记 module 边界并记录它的 import graph。
 */
export function Module<T extends FModule>(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => {
        Singleton()(target);
        Reflect.defineMetadata(MODULE_METADATA_KEY, metadata, target);
    };
}

/**
 * EN: Injects a property by reflected design type.
 * ZH: 按 reflected design type 注入属性。
 */
export function Inject(): PropertyDecorator;
/**
 * EN: Registers one property key whose dependency type is read from reflected metadata at resolution time.
 * ZH: 登记一个属性键，其依赖类型在解析时从反射元数据读取。
 */
export function Inject(): PropertyDecorator {
    return (target, propertyKey) => registerInject(target, propertyKey, false);
}

/**
 * EN: Injects a class using values from the current host scope.
 * ZH: 使用当前 host scope 中的值注入类。
 */
export function Scope(): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerInject(target, propertyKey, true);
    };
}

/**
 * EN: Stores one property-injection metadata record on the host constructor.
 * ZH: 在 host 构造器上保存一条属性注入元数据。
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
 * EN: Marks one lifecycle method to run after IOC injection.
 * ZH: 标记一个在 IOC 注入后运行的生命周期方法。
 */
export function Init(): MethodDecorator {
    return (target, propertyKey) => Reflect.defineMetadata(INIT_METADATA_KEY, propertyKey, target);
}

/**
 * EN: Injects `ConfigService`, optionally exposing one nested config key.
 * ZH: 注入 `ConfigService`，并可选择暴露一个嵌套配置键。
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
 * EN: Injects a canonical prompt file or directory resolved from the repository root.
 * ZH: 从仓库根目录按约定解析并注入 prompt 文件或目录。
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

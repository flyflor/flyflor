import {
    INIT_METADATA_KEY,
    INJECT_METADATA_INSTANCE_KEY,
    INJECT_METADATA_KEY,
    MODULE_METADATA_KEY,
    PROVIDER_SINGLETON_KEY,
    type ClassType,
    type InjectInstanceMetadata,
    type InjectMetadata,
} from './ioc/types';
import { defineMetadata, getMetadata, useContainer } from './ioc/container';
import type { FModule } from './ioc/abstracts';
import { get } from 'lodash-es';
import { isAbsolute, join } from 'node:path';

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
    return (target) => defineMetadata(PROVIDER_SINGLETON_KEY, true, target);
}

/**
 * EN: Marks a module boundary and records its import graph.
 * ZH: 标记 module 边界并记录它的 import graph。
 */
export function Module<T extends FModule>(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => {
        Singleton()(target);
        defineMetadata(MODULE_METADATA_KEY, metadata, target);
    };
}

/**
 * EN: Injects a property by reflected design type.
 * ZH: 按 reflected design type 注入属性。
 */
export function Inject(): PropertyDecorator;
/**
 * EN: Injects a property using constructor args returned from a host callback.
 * ZH: 使用 host callback 返回的构造参数注入属性。
 */
export function Inject<TThis, C>(callback: (this: TThis) => C): PropertyDecorator;
/**
 * EN: Injects a property using an explicit class type.
 * ZH: 使用显式 class type 注入属性。
 */
export function Inject(classType: ClassType): PropertyDecorator;
/**
 * EN: Supports bare `@Inject` decorator syntax.
 * ZH: 支持裸 `@Inject` 装饰器语法。
 */
export function Inject(target: object, propertyKey: string | symbol): void;
/**
 * EN: Registers property injection metadata for the IOC container.
 * ZH: 为 IOC container 注册属性注入元数据。
 */
export function Inject(): PropertyDecorator | void {
    const props = arguments;
    if (props.length >= 2 && ['symbol', 'string'].includes(typeof props[1])) {
        const [target, propertyKey] = props as unknown as [object, string | symbol];
        registerInject(target, propertyKey, getMetadata('design:type', target, propertyKey));
    } else if (!props[0]) {
        return (target: object, propertyKey: string | symbol) => {
            registerInject(target, propertyKey, getMetadata('design:type', target, propertyKey));
        };
    } else {
        return (target: object, propertyKey: string | symbol) => {
            const reflectedClassType = getMetadata('design:type', target, propertyKey);
            const value = props[0];
            const explicitClassType = isClassType(value);
            registerInject(
                target,
                propertyKey,
                explicitClassType ? value : reflectedClassType,
                explicitClassType ? undefined : value as InjectMetadata['factoryArgs'],
            );
        };
    }
}

/**
 * EN: Injects a class using values from the current host scope.
 * ZH: 使用当前 host scope 中的值注入类。
 */
export function Scope(): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerInject(target, propertyKey, getMetadata('design:type', target, propertyKey), undefined, true);
    };
}

/**
 * EN: Stores one property-injection metadata record on the host constructor.
 * ZH: 在 host 构造器上保存一条属性注入元数据。
 */
function registerInject(
    target: object,
    propertyKey: string | symbol,
    classType: ClassType,
    factoryArgs?: InjectMetadata['factoryArgs'],
    scoped?: boolean,
): void {
    const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
    data.push({ propertyKey, classType, factoryArgs, scoped });
    defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
}

/**
 * EN: Detects class constructors passed to `@Inject`.
 * ZH: 判断传给 `@Inject` 的值是否为 class 构造器。
 */
function isClassType(value: unknown): value is ClassType {
    return typeof value === 'function' && Function.prototype.toString.call(value).startsWith('class ');
}

/**
 * EN: Marks one lifecycle method to run after IOC injection.
 * ZH: 标记一个在 IOC 注入后运行的生命周期方法。
 */
export function Init(): MethodDecorator {
    return (target, propertyKey) => defineMetadata(INIT_METADATA_KEY, propertyKey, target);
}

/**
 * EN: Injects `ConfigService`, optionally exposing one nested config key.
 * ZH: 注入 `ConfigService`，并可选择暴露一个嵌套配置键。
 */
export function Config(key?: string): PropertyDecorator {
    return (target, propertyKey) => {
        const configStorageKey = Symbol(String(propertyKey));
        const data: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, target.constructor) || [];
        data.push({
            propertyKey,
            instance: async () => {
                const { ConfigService } = await import('@/config');
                return useContainer().getAsync(ConfigService);
            },
        });
        defineMetadata(INJECT_METADATA_INSTANCE_KEY, data, target.constructor);
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
 * EN: Injects a canonical prompt file or directory.
 * ZH: 注入一个规范 prompt 文件或目录。
 *
 * EN: Relative paths resolve from the repository root; absolute paths load as-is
 * (identity packages and live disposable trees).
 * ZH: 相对路径相对仓库根解析；绝对路径原样加载（身份包与 live 临时树）。
 */
export function Prompt<TThis = object>(path: string | ((this: TThis, prop: TThis) => string)): PropertyDecorator {
    return (target, propertyKey) => {
        const promptStorageKey = Symbol(String(propertyKey));
        const data: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, target.constructor) || [];
        data.push({
            propertyKey,
            instance: async function (this: TThis) {
                const [{ useRootPath }, { PromptService }] = await Promise.all([
                    import('@/config'),
                    import('@/prompt/service'),
                ]);
                const resolved = typeof path === 'function' ? path.call(this, this) : path;
                const promptPath = isAbsolute(resolved) ? resolved : join(useRootPath(), resolved);
                return useContainer().getAsync(PromptService, promptPath);
            },
        });
        defineMetadata(INJECT_METADATA_INSTANCE_KEY, data, target.constructor);
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

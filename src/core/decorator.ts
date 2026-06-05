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

export type Ctor<T = unknown> = new (...args: never[]) => T;

export type AbstractCtor<T = unknown> = abstract new (...args: never[]) => T;

export type ModuleReference = Ctor;

/**
 * Metadata accepted by `@Module`.
 * `imports` describes classes that must be reachable from the module's DI subtree; `providers` and `exports`
 * are reserved module-boundary declarations for Nest-style wiring while the runtime keeps class inheritance and
 * `@Inject` edges as the source of truth.
 */
export interface ModuleMetadata {
    imports?: ModuleReference[];
}

export function Provide(): ClassDecorator {
    return (target) => { }
}

export function Singleton(): ClassDecorator {
    return (target) => defineMetadata(PROVIDER_SINGLETON_KEY, true, target);
}

export function Service(): ClassDecorator {
    return (target) => Provide()(target);
}

export function Component(): ClassDecorator {
    return (target) => Provide()(target);
}

export function Plugin(): ClassDecorator {
    return (target) => Provide()(target);
}

export function Repo(): ClassDecorator {
    return (target) => Singleton()(target);
}

export function Module<T extends FModule>(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => {
        Singleton()(target);
        defineMetadata(MODULE_METADATA_KEY, metadata, target);
    };
}

export function Controller() {
    return <T extends Ctor>(target: T) => {
        Singleton()(target as unknown as Function);
    };
}

// 注入装饰器，用于注册依赖注入服务类
export function Inject(): PropertyDecorator;
export function Inject(classType: ClassType): PropertyDecorator;
export function Inject(target: object, propertyKey: string | symbol): void;
export function Inject(): PropertyDecorator | void {
    const props = arguments;
    if (!props[0]) {
        // 无参数时，返回属性装饰器
        return (target: object, propertyKey: string | symbol) => {
            const classType = getMetadata('design:type', target, propertyKey);
            const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
            data.push({ propertyKey, classType });
            defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
        };
    } else if (['symbol', 'string'].includes(typeof props[1])) {
        // 有参数时，根据参数类型判断是否为类类型
        const [target, propertyKey] = props;
        const classType = getMetadata('design:type', target, propertyKey);
        const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
        data.push({ propertyKey, classType });
        defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
    } else {
        // 有参数时，根据参数类型判断是否为类类型
        return (target: object, propertyKey: string | symbol) => {
            const classType = props[0];
            const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
            data.push({ propertyKey, classType });
            defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
        };
    }
}

export function Init(): MethodDecorator {
    return (target, propertyKey) => defineMetadata(INIT_METADATA_KEY, propertyKey, target);
}

/**
 * Class decorator marking a class as a capillary guard (permission / policy subscriber).
 *
 * The decorator is a pure intent marker (per AGENTS.md red line 2 / §2): the runtime grouping is
 * expressed structurally by extending `FGuard` (or `FSandBox` for the sandbox specialization), and
 * `listModule(FGuard)` discovers all guards via the prototype chain.
 */
export function Guard(): ClassDecorator {
    return (target) => {
        Singleton()(target);
    };
}

/**
 * Class decorator marking a class as a sandbox policy subscriber.
 *
 * Composes with `@Guard()` so a sandbox class is also discovered by `listModule(FGuard)`. The
 * specialization is expressed by extending `FSandBox` (which extends `FGuard`).
 */
export function SandBox(): ClassDecorator {
    return (target) => {
        Guard()(target);
    };
}

export function Config(key?: string): PropertyDecorator {
    return (target, propertyKey) => {
        const configStorageKey = Symbol(String(propertyKey));
        const data: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, target.constructor) || [];
        data.push({
            propertyKey,
            instance: async () => {
                const { ConfigComponent } = await import('@/config');
                return useContainer().getAsync(ConfigComponent);
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

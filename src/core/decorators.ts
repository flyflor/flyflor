import {
    INIT_METADATA_KEY,
    INJECT_METADATA_KEY,
    MODULE_METADATA_KEY,
    type ClassType,
    type InjectMetadata,
} from "./ioc/types.ts";
import { defineMetadata, getMetadata, getOwnMetadata, useContainer } from "./ioc/container.ts";
import type { FModule } from "./ioc/superclz.ts";

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

/**
 * One prompt-template binding recorded by `@Prompt`.
 * `propertyKey` is the decorated class property; `path` is the canonical English prompt path under `prompts/`
 * that runtime code can load without hard-coded prompt locations.
 */
export interface PromptBinding {
    propertyKey: string | symbol;
    path: string;
}

/**
 * Resolves the constructor that owns a property or method decorator target.
 * Member decorators receive the class prototype, while metadata readers store records on the constructor so
 * inherited DI metadata can be discovered consistently.
 * @param target - the prototype object received by a property or method decorator.
 * @returns the owning class constructor.
 */
function ownerOf(target: object): AbstractCtor {
    return (target as { constructor: AbstractCtor }).constructor;
}

export function Singleton(): ClassDecorator {
    return (target) => {};
}

export function Service(): ClassDecorator {
    return (target) => {};
}

export function Component(): ClassDecorator {
    return (target) => {};
}

export function Plugin(): ClassDecorator {
    return (target) => {};
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

// 注入装饰器，用于注册依赖注入服务类
export function Inject(): PropertyDecorator;
export function Inject(classType: ClassType): PropertyDecorator;
export function Inject(target: object, propertyKey: string | symbol): void;
export function Inject(): PropertyDecorator | void {
    const props = arguments;
    if (!props[0]) {
        // 无参数时，返回属性装饰器
        return (target: object, propertyKey: string | symbol) => {
            const classType = getMetadata("design:type", target, propertyKey);
            const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
            data.push({ propertyKey, classType });
            defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
        };
    } else if (["symbol", "string"].includes(typeof props[1])) {
        // 有参数时，根据参数类型判断是否为类类型
        const [target, propertyKey] = props;
        const classType = getMetadata("design:type", target, propertyKey);
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

/**
 * Marks an (async) method as the class's initialization hook, awaited by `container.getAsync`.
 * Dependencies are initialized before this runs, so a module's config is ready inside its `@Init`.
 */
export function Init(): MethodDecorator {
    return (target, propertyKey) => {
        defineMetadata(Init, propertyKey, ownerOf(target));
        defineMetadata(INIT_METADATA_KEY, propertyKey, target);
    };
}

/**
 * Binds a property to a prompt template at `prompts/<name>.md` (the English `.md` is the only file read).
 * The decorator records the binding; the owning class loads the file at runtime.
 * @param path - repo-relative path to the canonical `.md` prompt.
 */
export function Prompt(path: string): PropertyDecorator {
    return (target, propertyKey) => {
        const owner = ownerOf(target);
        const bindings = (getOwnMetadata(Prompt, owner) as PromptBinding[] | undefined) ?? [];
        bindings.push({ propertyKey, path });
        defineMetadata(Prompt, bindings, owner);
    };
}

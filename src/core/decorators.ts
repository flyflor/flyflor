import "reflect-metadata";

/**
 * Concrete constructor type used wherever the container must be able to `new` a class.
 * `T` is the produced instance type.
 */
export type Ctor<T = unknown> = new (...args: never[]) => T;

/**
 * Abstract-or-concrete constructor type, used to reference base classes (e.g. in `listModule(Base)`).
 * `T` is the produced instance type.
 */
export type AbstractCtor<T = unknown> = abstract new (...args: never[]) => T;

/**
 * A reference to another class inside `@Module` metadata (an imported module, a provider, or an export).
 */
export type ModuleReference = Ctor;

/**
 * Declarative description of a module boundary, modelled on NestJS.
 * - `imports`: upstream modules whose exports this module depends on.
 * - `providers`: injectable classes this module owns.
 * - `exports`: classes this module makes available to importers.
 */
export interface ModuleMetadata {
    imports?: ModuleReference[];
    providers?: ModuleReference[];
    exports?: ModuleReference[];
}

/**
 * One `@Prompt`-bound property: which property holds the template and which `prompts/<name>.md` path backs it.
 */
export interface PromptBinding {
    propertyKey: string | symbol;
    path: string;
}

/**
 * Resolves the prototype owner (the class constructor) for a property/method decorator target.
 * @param target - the prototype object passed to a member decorator.
 * @returns the owning constructor.
 */
function ownerOf(target: object): AbstractCtor {
    return (target as { constructor: AbstractCtor }).constructor;
}

// --- scope/role markers ---
// These carry NO container behavior and NO classification key/enum: scope and lifecycle come from the base
// class a type extends (FService/FComponent/FModule/FRepo/FPlugin/FGuard) and from the structural DI tree.
// The markers exist so a class declaration reads in NestJS style and the convention "every node is declared"
// is visible at the call site.

/**
 * Marks a class as a stateless injectable service (pairs with `extends FService`). Intent marker only.
 */
export function Service(): ClassDecorator {
    return () => {};
}

/**
 * Marks a class as a stateful component (pairs with `extends FComponent`). Intent marker only.
 */
export function Component(): ClassDecorator {
    return () => {};
}

/**
 * Marks a class as an external plugin boundary (pairs with `extends FPlugin`). Intent marker only.
 */
export function Plugin(): ClassDecorator {
    return () => {};
}

/**
 * Marks a class as a data repository under `src/entities` (pairs with `extends FRepo`). Intent marker only.
 */
export function Repo(): ClassDecorator {
    return () => {};
}

/**
 * Marks a class as a permission/policy guard (pairs with `extends FGuard`). Intent marker only;
 * guards are discovered structurally via `listModule(FGuard)`, not via this marker.
 */
export function Guard(): ClassDecorator {
    return () => {};
}

/**
 * Marks a class as a sandbox guard — a specialization of `@Guard` (pairs with `extends FSandBox`).
 * It **inherits `@Guard`** by invoking it, so the decorator relationship mirrors the class relationship.
 */
export function SandBox(): ClassDecorator {
    return (target) => {
        Guard()(target);
    };
}

// --- structural wiring decorators (the edges and hooks of the DI tree; required by rules 9 & 10) ---

/**
 * Declares a class as a module boundary and stores its `imports`/`providers`/`exports`.
 * The bootstrap reads this to register the module graph — this metadata *is* the DI tree, not a classifier.
 * @param metadata - the module declaration; defaults to an empty boundary.
 */
export function Module(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => Reflect.defineMetadata(Module, metadata, target);
}

/**
 * Marks a property for type-based injection: the container reads the property's `design:type` and assigns
 * the resolved dependency (no string/symbol token). Requires `emitDecoratorMetadata` (see tsconfig).
 */
export function Inject(): PropertyDecorator {
    return (target, propertyKey) => {
        const owner = ownerOf(target);
        const keys = (Reflect.getOwnMetadata(Inject, owner) as (string | symbol)[] | undefined) ?? [];
        if (!keys.includes(propertyKey)) {
            keys.push(propertyKey);
        }
        Reflect.defineMetadata(Inject, keys, owner);
    };
}

/**
 * Marks an (async) method as the class's initialization hook, awaited by `container.getAsync`.
 * Dependencies are initialized before this runs, so a module's config is ready inside its `@Init`.
 */
export function Init(): MethodDecorator {
    return (target, propertyKey) => {
        Reflect.defineMetadata(Init, propertyKey, ownerOf(target));
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
        const bindings = (Reflect.getOwnMetadata(Prompt, owner) as PromptBinding[] | undefined) ?? [];
        bindings.push({ propertyKey, path });
        Reflect.defineMetadata(Prompt, bindings, owner);
    };
}

// --- metadata readers used by the container and bootstrap (wiring, not classification) ---

/**
 * Returns a class's own `@Module` metadata, or `undefined` for a non-module (leaf) class.
 * Uses own-metadata so module declarations are never inherited from a base module.
 * @param ctor - the class to inspect.
 */
export function getModuleMetadata(ctor: AbstractCtor): ModuleMetadata | undefined {
    return Reflect.getOwnMetadata(Module, ctor) as ModuleMetadata | undefined;
}

/**
 * Collects every `@Inject` property key declared on a class and its base classes.
 * Walks the constructor prototype chain so injected properties defined on a base are honored.
 * @param ctor - the class to inspect.
 * @returns the de-duplicated list of injectable property keys.
 */
export function collectInjectKeys(ctor: AbstractCtor): (string | symbol)[] {
    const keys: (string | symbol)[] = [];
    let current: unknown = ctor;
    while (typeof current === "function" && current !== Function.prototype) {
        const own = (Reflect.getOwnMetadata(Inject, current) as (string | symbol)[] | undefined) ?? [];
        for (const key of own) {
            if (!keys.includes(key)) {
                keys.push(key);
            }
        }
        current = Object.getPrototypeOf(current);
    }
    return keys;
}

/**
 * Returns the method name marked with `@Init` for a class (inherited from a base if not overridden), or `undefined`.
 * @param ctor - the class to inspect.
 */
export function getInitMethod(ctor: AbstractCtor): string | symbol | undefined {
    return Reflect.getMetadata(Init, ctor) as string | symbol | undefined;
}

/**
 * Returns the `@Prompt` bindings declared on a class and its base classes.
 * @param ctor - the class to inspect.
 */
export function listPromptBindings(ctor: AbstractCtor): PromptBinding[] {
    const bindings: PromptBinding[] = [];
    let current: unknown = ctor;
    while (typeof current === "function" && current !== Function.prototype) {
        const own = (Reflect.getOwnMetadata(Prompt, current) as PromptBinding[] | undefined) ?? [];
        bindings.push(...own);
        current = Object.getPrototypeOf(current);
    }
    return bindings;
}

import "reflect-metadata";
import { collectInjectKeys, getInitMethod } from "../decorators.ts";
import type { AbstractCtor, Ctor } from "../decorators.ts";

/** reflect-metadata key the TypeScript/Bun transpiler fills with a property's declared type. */
const DESIGN_TYPE = "design:type";

/**
 * Flyflor's inversion-of-control container and the ONLY place in the codebase allowed to call `new` (rule 9).
 *
 * The DI tree is purely structural — no enums, no classification keys:
 * - identity is the class constructor (no string/symbol tokens);
 * - edges are `@Inject() public dep: Dep` properties, resolved from reflect-metadata `design:type`;
 * - scope groups are class inheritance, read back via `listModule(Base)`;
 * - every resolved class is a single shared node (one cached instance) — there is no per-class lifecycle flag.
 *
 * Construction is two-phase (build, cache, then inject) so dependency cycles resolve to the cached instance;
 * therefore injected dependencies must only be used after `@Init`, never inside a constructor.
 */
export class Container {
    /** One shared instance per class — the nodes of the DI tree, keyed by constructor. */
    private readonly instances = new Map<AbstractCtor, unknown>();
    /** Every constructor the container has seen, so `listModule` can scan by base class. */
    private readonly registered = new Set<Ctor>();
    /** Constructors whose `@Init` hook already ran, keeping initialization idempotent. */
    private readonly initialized = new Set<AbstractCtor>();

    /**
     * Records a constructor as part of the resolvable graph without instantiating it.
     * The bootstrap calls this while walking `@Module` metadata so `listModule` can later find subclasses.
     * @param ctor - the concrete class to track.
     */
    public register(ctor: Ctor): void {
        this.registered.add(ctor);
    }

    /**
     * Resolves the shared instance of `ctor`, constructing it and its `@Inject` dependencies on first use.
     * @param ctor - the class to resolve.
     * @returns the wired instance (dependencies assigned; `@Init` not awaited — use `getAsync` for that).
     */
    public get<T>(ctor: Ctor<T>): T {
        const cached = this.instances.get(ctor);
        if (cached !== undefined) {
            return cached as T;
        }
        // The single permitted `new` site: every other instance in Flyflor originates here.
        const instance = new ctor();
        this.instances.set(ctor, instance); // cache before injecting so dependency cycles resolve to this instance
        this.registered.add(ctor);
        this.injectProperties(instance as object, ctor);
        return instance;
    }

    /**
     * Resolves an instance and awaits the `@Init` hooks of its dependencies (first) and then itself.
     * The bootstrap uses this so, e.g., config is loaded before the module that depends on it initializes.
     * @param ctor - the class to resolve and initialize.
     * @returns the fully initialized instance.
     */
    public async getAsync<T>(ctor: Ctor<T>): Promise<T> {
        const instance = this.get(ctor);
        await this.initialize(ctor);
        return instance;
    }

    /**
     * Returns one resolved instance per registered class that extends `base` — the inheritance Scope of rule 10.
     * Example: `listModule(FGuard)` returns every guard so each can subscribe to the capillary layer.
     * @param base - the (usually abstract) base class defining the scope.
     * @returns the resolved subclass instances.
     */
    public listModule<T>(base: AbstractCtor<T>): T[] {
        const instances: T[] = [];
        for (const ctor of this.registered) {
            if (base.prototype.isPrototypeOf(ctor.prototype)) {
                instances.push(this.get(ctor as unknown as Ctor<T>));
            }
        }
        return instances;
    }

    /**
     * Wires every `@Inject` property of `instance` by resolving the property's reflected type.
     * @param instance - the freshly constructed object whose dependencies must be assigned.
     * @param ctor - the constructor, used to read accumulated `@Inject` keys and reflected types.
     */
    private injectProperties(instance: object, ctor: Ctor): void {
        for (const key of collectInjectKeys(ctor)) {
            const dependency = Reflect.getMetadata(DESIGN_TYPE, ctor.prototype, key) as Ctor | undefined;
            if (dependency === undefined) {
                throw Object.assign(new Error("Missing design:type metadata for @Inject property"), {
                    detail: { owner: ctor.name, property: String(key) },
                });
            }
            (instance as Record<string | symbol, unknown>)[key] = this.get(dependency);
        }
    }

    /**
     * Runs `@Init` hooks bottom-up: a class's injected dependencies are initialized before the class itself.
     * Idempotent per constructor.
     * @param ctor - the class whose initialization (and its dependencies') must complete.
     */
    private async initialize(ctor: AbstractCtor): Promise<void> {
        if (this.initialized.has(ctor)) {
            return;
        }
        this.initialized.add(ctor);
        for (const key of collectInjectKeys(ctor)) {
            const dependency = Reflect.getMetadata(DESIGN_TYPE, ctor.prototype, key) as Ctor | undefined;
            if (dependency !== undefined) {
                await this.initialize(dependency);
            }
        }
        const initMethod = getInitMethod(ctor);
        if (initMethod !== undefined) {
            const instance = this.get(ctor as Ctor) as Record<string | symbol, unknown>;
            const hook = instance[initMethod];
            if (typeof hook === "function") {
                await (hook as () => unknown).call(instance);
            }
        }
    }
}

/**
 * Creates a fresh IoC container.
 * Defined here so the `new Container()` call lives inside the container module — the only `new` site (rule 9).
 * @returns a new, empty `Container`.
 */
export function createContainer(): Container {
    return new Container();
}

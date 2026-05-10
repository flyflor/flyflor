export interface InjectionToken<TValue> {
    readonly key: symbol;
    readonly name: string;
}

export function createInjectionToken<TValue>(name: string): InjectionToken<TValue> {
    return {
        key: Symbol(name),
        name,
    };
}

export type InjectionFactory<TValue> = (container: DependencyContainer) => TValue;
export type InjectionScope = "factory" | "singleton";

interface Binding<TValue> {
    cached?: TValue;
    factory: InjectionFactory<TValue>;
    scope: InjectionScope;
    resolved: boolean;
}

export class DependencyContainer {
    private readonly bindings = new Map<symbol, Binding<unknown>>();

    bindSingleton<TValue>(token: InjectionToken<TValue>, value: TValue): this {
        this.bindings.set(token.key, {
            cached: value,
            factory: () => value,
            scope: "singleton",
            resolved: true,
        });
        return this;
    }

    bindFactory<TValue>(token: InjectionToken<TValue>, factory: InjectionFactory<TValue>): this {
        return this.bindProvider(token, factory, "factory");
    }

    bindProvider<TValue>(
        token: InjectionToken<TValue>,
        factory: InjectionFactory<TValue>,
        scope: InjectionScope = "singleton",
    ): this {
        this.bindings.set(token.key, {
            factory,
            scope,
            resolved: false,
        });
        return this;
    }

    has(token: InjectionToken<unknown>): boolean {
        return this.bindings.has(token.key);
    }

    resolve<TValue>(token: InjectionToken<TValue>): TValue {
        const binding = this.bindings.get(token.key);
        if (!binding) {
            throw new Error(`Missing dependency: ${token.name}`);
        }

        if (binding.scope === "singleton" && binding.resolved) {
            return binding.cached as TValue;
        }

        const value = binding.factory(this) as TValue;
        if (binding.scope === "singleton") {
            binding.cached = value;
            binding.resolved = true;
        }

        return value;
    }
}

export { DependencyContainer as FpcDependencyContainer };

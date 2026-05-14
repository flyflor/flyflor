import { ProviderScope, type ProviderScope as ProviderScopeType } from "../../../protocol/contracts/index.ts";
import type { ComponentMetadata } from "../composition/index.ts";

export type ClassToken<TValue> = abstract new (...args: any[]) => TValue;
export type DependencyToken<TValue> = InjectionToken<TValue> | ClassToken<TValue>;

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
export type InjectionScope = ProviderScopeType;

interface Binding<TValue> {
    cached?: TValue;
    factory: InjectionFactory<TValue>;
    scope: InjectionScope;
    resolved: boolean;
}

export class DependencyContainer {
    private readonly bindings = new Map<object | symbol, Binding<unknown>>();

    public bindSingleton<TValue>(token: DependencyToken<TValue>, value: TValue): this {
        this.bindings.set(tokenKey(token), {
            cached: value,
            factory: () => value,
            scope: ProviderScope.Singleton,
            resolved: true,
        });
        return this;
    }

    public bindFactory<TValue>(token: DependencyToken<TValue>, factory: InjectionFactory<TValue>): this {
        return this.bindProvider(token, factory, ProviderScope.Factory);
    }

    public bindTransient<TValue>(token: DependencyToken<TValue>, factory: InjectionFactory<TValue>): this {
        return this.bindFactory(token, factory);
    }

    public bindComponent<TValue>(
        token: DependencyToken<TValue>,
        factory: InjectionFactory<TValue>,
        metadata: Pick<ComponentMetadata, "provider">,
    ): this {
        return this.bindProvider(token, factory, metadata.provider?.scope ?? ProviderScope.Singleton);
    }

    public bindProvider<TValue>(
        token: DependencyToken<TValue>,
        factory: InjectionFactory<TValue>,
        scope: InjectionScope = ProviderScope.Singleton,
    ): this {
        this.bindings.set(tokenKey(token), {
            factory,
            scope,
            resolved: false,
        });
        return this;
    }

    public has(token: DependencyToken<unknown>): boolean {
        return this.bindings.has(tokenKey(token));
    }

    public resolve<TValue>(token: DependencyToken<TValue>): TValue {
        const binding = this.bindings.get(tokenKey(token));
        if (!binding) {
            throw new Error(`Missing dependency: ${tokenName(token)}`);
        }

        if (binding.scope === ProviderScope.Singleton && binding.resolved) {
            return binding.cached as TValue;
        }

        const value = binding.factory(this) as TValue;
        if (binding.scope === ProviderScope.Singleton) {
            binding.cached = value;
            binding.resolved = true;
        }

        return value;
    }
}

function tokenKey(token: DependencyToken<unknown>): object | symbol {
    return isInjectionToken(token) ? token.key : token;
}

function tokenName(token: DependencyToken<unknown>): string {
    return isInjectionToken(token) ? token.name : token.name;
}

export function isInjectionToken(value: unknown): value is InjectionToken<unknown> {
    return (
        typeof value === "object" &&
        value !== null &&
        "key" in value &&
        "name" in value &&
        typeof (value as { key?: unknown }).key === "symbol" &&
        typeof (value as { name?: unknown }).name === "string"
    );
}

export { DependencyContainer as FpcDependencyContainer };

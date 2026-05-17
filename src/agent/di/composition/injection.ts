import type { DependencyToken } from "../factory/container.ts";

export interface InjectionMetadata {
    parameterIndex?: number;
    propertyKey?: string | symbol;
    token: DependencyToken<unknown>;
}

const injectionMetadata = new WeakMap<object, InjectionMetadata[]>();

export function registerInjectionMetadata(
    target: object,
    token: DependencyToken<unknown>,
    propertyKey?: string | symbol,
    parameterIndex?: number,
): void {
    const entries = injectionMetadata.get(target) ?? [];
    entries.push({
        parameterIndex,
        propertyKey,
        token,
    });
    injectionMetadata.set(target, entries);
}

export function readInjectionMetadata(target: object): InjectionMetadata[] {
    return [...(injectionMetadata.get(target) ?? [])];
}

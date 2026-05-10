import type { InjectionToken } from "../factory/dependency.container.ts";

export interface InjectionMetadata {
    parameterIndex?: number;
    propertyKey?: string | symbol;
    token: InjectionToken<unknown>;
}

const injectionMetadata = new WeakMap<object, InjectionMetadata[]>();

export function registerInjectionMetadata(
    target: object,
    token: InjectionToken<unknown>,
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

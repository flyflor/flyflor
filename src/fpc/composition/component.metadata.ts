import {
    ComponentKind,
    FpcLayer,
    ProviderScope,
    type ComponentKind as ComponentKindType,
    type FpcLayer as FpcLayerType,
    type ProviderScope as ProviderScopeType,
} from "../contracts/index.ts";

export interface ComponentCompatibility {
    protocol?: string;
    source?: string;
    version?: string;
}

export interface ComponentMetadata {
    kind: ComponentKindType;
    layer: FpcLayerType;
    name: string;
    compatibility?: ComponentCompatibility;
    provider?: ComponentProviderMetadata;
    tags: string[];
}

export type FpcComponentConstructor<TComponent = object, TArgs extends unknown[] = unknown[]> = new (
    ...args: TArgs
) => TComponent;

export interface ComponentDecoratorOptions {
    compatibility?: ComponentCompatibility;
    layer?: FpcLayerType;
    name?: string;
    provider?: boolean | ComponentProviderOptions;
    tags?: string[];
}

export interface ComponentProviderOptions {
    scope?: ProviderScopeType;
    token?: string;
}

export interface ComponentProviderMetadata {
    scope: ProviderScopeType;
    token: string;
}

const componentMetadata = new WeakMap<Function, ComponentMetadata>();

export function registerComponentMetadata(
    kind: ComponentKindType,
    options?: ComponentDecoratorOptions | string,
    defaults: ComponentDecoratorOptions = {},
): ClassDecorator {
    return (target) => {
        const metadata = normalizeComponentMetadata(kind, target.name, options, defaults);
        componentMetadata.set(target, {
            ...metadata,
        });
    };
}

export function readComponentMetadata(target: Function): ComponentMetadata | undefined {
    return componentMetadata.get(target);
}

export function isComponentKind(value: unknown): value is ComponentKindType {
    return Object.values(ComponentKind).includes(value as ComponentKindType);
}

function normalizeComponentMetadata(
    kind: ComponentKindType,
    fallbackName: string,
    options: ComponentDecoratorOptions | string | undefined,
    defaults: ComponentDecoratorOptions,
): ComponentMetadata {
    const normalized = typeof options === "string" ? { name: options } : (options ?? {});
    const name = normalized.name ?? defaults.name ?? fallbackName;
    const layer = normalized.layer ?? defaults.layer ?? FpcLayer.Capability;
    const provider = normalizeProviderMetadata(name, layer, normalized.provider ?? defaults.provider);
    return {
        kind,
        layer,
        name,
        compatibility: normalized.compatibility ?? defaults.compatibility,
        provider,
        tags: [...(defaults.tags ?? []), ...(normalized.tags ?? [])],
    };
}

function normalizeProviderMetadata(
    name: string,
    layer: FpcLayerType,
    options: boolean | ComponentProviderOptions | undefined,
): ComponentProviderMetadata | undefined {
    if (!options) {
        return undefined;
    }
    if (options === true) {
        return {
            scope: ProviderScope.Singleton,
            token: `${layer}.${name}`,
        };
    }
    return {
        scope: options.scope ?? ProviderScope.Singleton,
        token: options.token ?? `${layer}.${name}`,
    };
}

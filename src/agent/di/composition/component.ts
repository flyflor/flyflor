import {
    ComponentKind,
    ArchitectureLayer,
    ProviderScope,
    type ComponentKind as ComponentKindType,
    type ArchitectureLayer as ArchitectureLayerType,
    type ProviderScope as ProviderScopeType,
} from "../../../protocol/contracts/enums.ts";
import {
    Blackboard,
    BrainComponent,
    CapabilityComponent,
    ContextComponent,
    CrystalComponent,
    FlyflorComponent,
    Gateway,
    GraphComponent,
    Memory,
    MemoryComponent,
    RedisComponent,
    Runtime,
    Sandbox,
    SQLiteComponent,
    SurrealComponent,
} from "../../../components/component.ts";

export interface ComponentCompatibility {
    protocol?: string;
    source?: string;
    version?: string;
}

export interface ComponentMetadata {
    kind: ComponentKindType;
    layer: ArchitectureLayerType;
    name: string;
    compatibility?: ComponentCompatibility;
    provider?: ComponentProviderMetadata;
    tags: string[];
}

export type ComponentConstructor<TComponent = object, TArgs extends unknown[] = unknown[]> = new (
    ...args: TArgs
) => TComponent;
export type FpcComponentConstructor<TComponent = object, TArgs extends unknown[] = unknown[]> = ComponentConstructor<
    TComponent,
    TArgs
>;

export interface ComponentDecoratorOptions {
    compatibility?: ComponentCompatibility;
    layer?: ArchitectureLayerType;
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
    kind: ComponentKindType | undefined,
    options?: ComponentDecoratorOptions | string,
    defaults: ComponentDecoratorOptions = {},
): ClassDecorator {
    return (target) => {
        const metadata = normalizeComponentMetadata(kind, target, options, defaults);
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
    kind: ComponentKindType | undefined,
    target: Function,
    options: ComponentDecoratorOptions | string | undefined,
    defaults: ComponentDecoratorOptions,
): ComponentMetadata {
    const normalized = typeof options === "string" ? { name: options } : (options ?? {});
    const inferredKind = inferComponentKind(target);
    const inferredLayer = inferComponentLayer(target);
    const name = normalized.name ?? defaults.name ?? inferComponentName(target);
    const layer = normalized.layer ?? defaults.layer ?? inferredLayer;
    const provider = normalizeProviderMetadata(name, layer, normalized.provider ?? defaults.provider);
    return {
        kind: kind ?? inferredKind,
        layer,
        name,
        compatibility: normalized.compatibility ?? defaults.compatibility,
        provider,
        tags: [...(defaults.tags ?? []), ...(normalized.tags ?? [])],
    };
}

function inferComponentKind(target: Function): ComponentKindType {
    const prototype = target.prototype;
    if (prototype instanceof Gateway) return ComponentKind.Gateway;
    if (prototype instanceof Blackboard) return ComponentKind.Blackboard;
    if (prototype instanceof Runtime) return ComponentKind.Runtime;
    if (prototype instanceof ContextComponent) return ComponentKind.Context;
    if (
        prototype instanceof Memory ||
        prototype instanceof MemoryComponent ||
        prototype instanceof BrainComponent ||
        prototype instanceof GraphComponent ||
        prototype instanceof SQLiteComponent
    ) {
        return ComponentKind.Memory;
    }
    if (prototype instanceof Sandbox) return ComponentKind.Sandbox;
    if (prototype instanceof CrystalComponent) return ComponentKind.Crystal;
    if (prototype instanceof CapabilityComponent) return ComponentKind.Component;
    if (prototype instanceof FlyflorComponent) return ComponentKind.Component;
    return ComponentKind.Component;
}

function inferComponentLayer(target: Function): ArchitectureLayerType {
    const prototype = target.prototype;
    if (prototype instanceof Runtime) return ArchitectureLayer.Runtime;
    if (
        prototype instanceof Gateway ||
        prototype instanceof Blackboard ||
        prototype instanceof ContextComponent ||
        prototype instanceof Memory ||
        prototype instanceof MemoryComponent ||
        prototype instanceof BrainComponent ||
        prototype instanceof GraphComponent ||
        prototype instanceof SQLiteComponent ||
        prototype instanceof Sandbox
    ) {
        return ArchitectureLayer.Control;
    }
    if (prototype instanceof CapabilityComponent || prototype instanceof RedisComponent || prototype instanceof SurrealComponent) {
        return ArchitectureLayer.Capability;
    }
    return ArchitectureLayer.Capability;
}

function inferComponentName(target: Function): string {
    return target.name
        .replace(/Module$/u, "")
        .replace(/Component$/u, "")
        .replace(/Store$/u, "")
        .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
        .toLowerCase();
}

function normalizeProviderMetadata(
    name: string,
    layer: ArchitectureLayerType,
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

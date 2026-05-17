import type { DependencyToken } from "../factory/container.ts";

export type ModuleProviderToken = DependencyToken<unknown> | string | symbol;

export interface ModuleDecoratorOptions {
    exports?: ModuleProviderToken[];
    imports?: Function[];
    name?: string;
    providers?: ModuleProviderToken[];
    tags?: string[];
}

export interface ModuleMetadata {
    exports: ModuleProviderToken[];
    imports: Function[];
    name: string;
    providers: ModuleProviderToken[];
    tags: string[];
}

const moduleMetadata = new WeakMap<Function, ModuleMetadata>();

export function registerModuleMetadata(options: ModuleDecoratorOptions | string = {}): ClassDecorator {
    return (target) => {
        const normalized = normalizeModuleMetadata(target.name, options);
        moduleMetadata.set(target, normalized);
    };
}

export function readModuleMetadata(target: Function): ModuleMetadata | undefined {
    return moduleMetadata.get(target);
}

export function assertModuleMetadata(target: Function): ModuleMetadata {
    const metadata = readModuleMetadata(target);
    if (!metadata) {
        throw new Error(`Missing module metadata: ${target.name}`);
    }
    return metadata;
}

function normalizeModuleMetadata(fallbackName: string, options: ModuleDecoratorOptions | string): ModuleMetadata {
    const normalized = typeof options === "string" ? { name: options } : options;
    return {
        exports: [...(normalized.exports ?? [])],
        imports: [...(normalized.imports ?? [])],
        name: normalized.name ?? fallbackName,
        providers: [...(normalized.providers ?? [])],
        tags: [...(normalized.tags ?? [])],
    };
}

import { ComponentKind, ArchitectureLayer } from "../../../protocol/contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Service(options: ComponentDecoratorOptions | string = {}): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Provider,
        layer: normalized.layer ?? ArchitectureLayer.Capability,
        provider: normalized.provider ?? true,
    });
}

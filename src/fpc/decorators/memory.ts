import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Memory(options: ComponentDecoratorOptions | string = "memory"): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Memory,
        layer: normalized.layer ?? FpcLayer.Control,
        name: normalized.name ?? "memory",
        provider: normalized.provider ?? true,
    });
}

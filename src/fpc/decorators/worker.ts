import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Worker(options: ComponentDecoratorOptions | string): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Worker,
        layer: normalized.layer ?? FpcLayer.Capability,
        provider: normalized.provider ?? true,
    });
}

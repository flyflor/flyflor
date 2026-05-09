import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Gateway(options: ComponentDecoratorOptions | string = "gateway"): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Gateway,
        layer: normalized.layer ?? FpcLayer.Control,
        name: normalized.name ?? "gateway",
        provider: normalized.provider ?? true,
    });
}

import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Blackboard(options: ComponentDecoratorOptions | string = "blackboard"): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Blackboard,
        layer: normalized.layer ?? FpcLayer.Control,
        name: normalized.name ?? "blackboard",
        provider: normalized.provider ?? true,
    });
}

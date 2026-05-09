import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import type { ComponentDecoratorOptions } from "../composition/index.ts";
import { Provide } from "./provide.ts";

export function Session(options: ComponentDecoratorOptions | string = "session"): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return Provide({
        ...normalized,
        kind: ComponentKind.Session,
        layer: normalized.layer ?? FpcLayer.Control,
        name: normalized.name ?? "session",
        provider: normalized.provider ?? true,
    });
}

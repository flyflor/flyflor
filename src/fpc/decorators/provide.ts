import { ComponentKind, type ComponentKind as ComponentKindType, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export interface ProvideDecoratorOptions extends ComponentDecoratorOptions {
    kind?: ComponentKindType;
}

export function Provide(options: ProvideDecoratorOptions | string = {}): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    const kind = normalized.kind ?? ComponentKind.Provider;
    return registerComponentMetadata(kind, normalized, {
        layer: FpcLayer.Capability,
        provider: true,
    });
}

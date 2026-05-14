import {
    ComponentKind,
    type ComponentKind as ComponentKindType,
    ArchitectureLayer,
} from "../../../protocol/contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export interface ProvideDecoratorOptions extends ComponentDecoratorOptions {
    kind?: ComponentKindType;
}

export function Provide(options: ProvideDecoratorOptions | string = {}): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    return registerComponentMetadata(normalized.kind ?? ComponentKind.Provider, normalized, {
        layer: ArchitectureLayer.Capability,
        provider: true,
    });
}

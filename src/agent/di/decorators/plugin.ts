import { ComponentKind, ArchitectureLayer } from "../../../protocol/contracts/enums.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Plugin(name: string, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(
        ComponentKind.Plugin,
        { ...options, name },
        { layer: ArchitectureLayer.Extension },
    );
}

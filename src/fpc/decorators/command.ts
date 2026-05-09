import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Command(name: string, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Command, { ...options, name }, { layer: FpcLayer.Control });
}

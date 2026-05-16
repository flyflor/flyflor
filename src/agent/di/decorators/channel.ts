import type { ChannelName } from "../../../protocol/contracts/enums.ts";
import { ComponentKind, ArchitectureLayer } from "../../../protocol/contracts/enums.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Channel(name: ChannelName, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Channel, { ...options, name }, { layer: ArchitectureLayer.Control });
}

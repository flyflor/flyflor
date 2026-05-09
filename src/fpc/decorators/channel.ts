import type { ChannelName } from "../contracts/index.ts";
import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Channel(name: ChannelName, options: Omit<ComponentDecoratorOptions, "name"> = {}): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Channel, { ...options, name }, { layer: FpcLayer.Control });
}

import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Runtime(options: ComponentDecoratorOptions | string = "runtime"): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Runtime, options, { layer: FpcLayer.Runtime, name: "runtime" });
}

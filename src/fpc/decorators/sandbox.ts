import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Sandbox(options: ComponentDecoratorOptions | string = "sandbox"): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Sandbox, options, { layer: FpcLayer.Control, name: "sandbox" });
}

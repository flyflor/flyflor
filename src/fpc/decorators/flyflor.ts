import { ComponentKind, FpcLayer } from "../contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function FlyFlor(options: ComponentDecoratorOptions | string = "flyflor"): ClassDecorator {
    return registerComponentMetadata(ComponentKind.FlyFlor, options, {
        layer: FpcLayer.Composition,
        name: "flyflor",
        tags: ["composition-root"],
    });
}

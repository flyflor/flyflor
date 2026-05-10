import { ComponentKind } from "../../../protocol/contracts/index.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Component(options?: ComponentDecoratorOptions | string): ClassDecorator {
    return registerComponentMetadata(ComponentKind.Component, options);
}

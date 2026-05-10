import { registerModuleMetadata, type ModuleDecoratorOptions } from "../composition/index.ts";

export function Module(options: ModuleDecoratorOptions | string = {}): ClassDecorator {
    return registerModuleMetadata(options);
}

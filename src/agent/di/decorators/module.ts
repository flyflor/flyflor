import { ProviderScope } from "../../../protocol/contracts/enums.ts";
import { registerComponentMetadata, registerModuleMetadata, type ModuleDecoratorOptions } from "../composition/index.ts";

export function Module(options: ModuleDecoratorOptions | string = {}): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : options;
    const moduleDecorator = registerModuleMetadata(options);
    const provideDecorator = registerComponentMetadata(undefined, normalized, {
        provider: { scope: ProviderScope.Singleton },
    });
    return (target) => {
        moduleDecorator(target);
        provideDecorator(target);
    };
}

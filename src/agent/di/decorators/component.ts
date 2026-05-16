import { ProviderScope } from "../../../protocol/contracts/enums.ts";
import { type ComponentDecoratorOptions, registerComponentMetadata } from "../composition/index.ts";

export function Component(options?: ComponentDecoratorOptions | string): ClassDecorator {
    const normalized = typeof options === "string" ? { name: options } : (options ?? {});
    return registerComponentMetadata(undefined, normalized, {
        provider: normalized.provider ?? { scope: ProviderScope.Singleton },
    });
}

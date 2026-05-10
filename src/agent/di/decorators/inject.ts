import { registerInjectionMetadata } from "../composition/index.ts";
import type { InjectionToken } from "../factory/index.ts";

export function Inject(token: InjectionToken<unknown>): ParameterDecorator & PropertyDecorator {
    const decorator = (target: object, propertyKey?: string | symbol, parameterIndex?: number): void => {
        registerInjectionMetadata(
            target,
            token,
            propertyKey,
            typeof parameterIndex === "number" ? parameterIndex : undefined,
        );
    };
    return decorator as ParameterDecorator & PropertyDecorator;
}

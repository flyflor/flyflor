import { LOGGER_DEFAULT_SCOPE } from './constants';
import { useLogger } from './composition';
import { type LoggerConfigurationInput, type LoggerOptions } from './types';

/**
 * Property decorator that exposes a scoped logger without requiring manual construction.
 * @param scopeOrOptions - optional scope string or logger options; defaults to the owning class name at runtime.
 * @param configuration - optional per-property configuration override when the first argument is a scope string.
 * @returns a property decorator that lazily returns a `FLogger`.
 */
export function Logger(scopeOrOptions?: string | LoggerOptions, configuration?: LoggerConfigurationInput): PropertyDecorator {
    return (target, propertyKey) => {
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: false,
            get() {
                const ownerScope = this?.constructor?.name ?? LOGGER_DEFAULT_SCOPE;
                if (typeof scopeOrOptions === 'string') {
                    return useLogger(scopeOrOptions, configuration);
                }
                return useLogger({
                    scope: scopeOrOptions?.scope ?? ownerScope,
                    configuration: scopeOrOptions?.configuration,
                });
            },
        });
    };
}

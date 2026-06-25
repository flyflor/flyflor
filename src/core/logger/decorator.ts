import { LOGGER_DEFAULT_SCOPE } from './constants';
import { useLogger } from './service';
import { type LoggerConfigurationInput, type LoggerOptions } from './types';

/**
 * EN: Property decorator that exposes a scoped logger without requiring manual construction.
 * ZH: 暴露一个作用域日志器的属性装饰器，无需手工构造。
 *
 * EN: `scopeOrOptions` is either a scope string or logger options; it defaults to the owning class name at
 * runtime. `configuration` overrides logger defaults when the first argument is a scope string.
 * ZH: `scopeOrOptions` 可以是作用域字符串或 logger 选项，默认使用运行时所属类名；当第一个参数是作用域字符串时，`configuration` 可覆盖 logger 默认值。
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

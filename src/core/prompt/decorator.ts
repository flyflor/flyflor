import { join } from 'path';
import { defineMetadata, getMetadata, INJECT_METADATA_INSTANCE_KEY, useContainer, type InjectInstanceMetadata } from '@/core/ioc';
import { PromptService } from './service';
import { useRootPath } from '@/configuration';

/**
 * EN: Injects a loaded prompt file or prompt package into a property.
 * ZH: 将已加载的 prompt 文件或 prompt 包注入到属性上。
 */
export function Prompt<TThis = object>(path: string | ((this: TThis, prop: TThis) => string)): PropertyDecorator {
    return (target, propertyKey) => {
        const promptStorageKey = Symbol(String(propertyKey));
        const data: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, target.constructor) || [];
        data.push({
            propertyKey,
            instance: function (this: TThis) {
                const promptPath = join(useRootPath(), typeof path === 'function' ? path.call(this, this) : path || '');
                return useContainer().getAsync(PromptService, promptPath);
            },
        });
        defineMetadata(INJECT_METADATA_INSTANCE_KEY, data, target.constructor);
        Object.defineProperty(target, propertyKey, {
            configurable: true,
            enumerable: true,
            get() {
                return this[promptStorageKey];
            },
            set(value) {
                this[promptStorageKey] = value;
            },
        });
    };
}

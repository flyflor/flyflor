import { INIT_METADATA_KEY, INJECT_METADATA_KEY, MODULE_METADATA_KEY, PROVIDER_SINGLETON_KEY, type ClassType, type InjectMetadata } from './ioc/types';
import { defineMetadata, getMetadata } from './ioc/container';
import type { FModule } from './ioc/superclz';
import { join } from 'path';
import { ROOT_PATH } from '@/constants';
import { existsSync, globSync, readFileSync, statSync } from 'fs';
import { set } from 'lodash-es';

export type Ctor<T = unknown> = new (...args: never[]) => T;

export type AbstractCtor<T = unknown> = abstract new (...args: never[]) => T;

export type ModuleReference = Ctor;

/**
 * Metadata accepted by `@Module`.
 * `imports` describes classes that must be reachable from the module's DI subtree; `providers` and `exports`
 * are reserved module-boundary declarations for Nest-style wiring while the runtime keeps class inheritance and
 * `@Inject` edges as the source of truth.
 */
export interface ModuleMetadata {
    imports?: ModuleReference[];
}
export interface PromptBinding {
    propertyKey: string | symbol;
    path: string;
}

export function Singleton(): ClassDecorator {
    return (target) => defineMetadata(PROVIDER_SINGLETON_KEY, true, target);
}

export function Service(): ClassDecorator {
    return (target) => { };
}

export function Component(): ClassDecorator {
    return (target) => { };
}

export function Plugin(): ClassDecorator {
    return (target) => { };
}

export function Repo(): ClassDecorator {
    return (target) => Singleton()(target);
}

export function Module<T extends FModule>(metadata: ModuleMetadata = {}): ClassDecorator {
    return (target) => {
        Singleton()(target);
        defineMetadata(MODULE_METADATA_KEY, metadata, target);
    };
}

// 注入装饰器，用于注册依赖注入服务类
export function Inject(): PropertyDecorator;
export function Inject(classType: ClassType): PropertyDecorator;
export function Inject(target: object, propertyKey: string | symbol): void;
export function Inject(): PropertyDecorator | void {
    const props = arguments;
    if (!props[0]) {
        // 无参数时，返回属性装饰器
        return (target: object, propertyKey: string | symbol) => {
            const classType = getMetadata('design:type', target, propertyKey);
            const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
            data.push({ propertyKey, classType });
            defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
        };
    } else if (['symbol', 'string'].includes(typeof props[1])) {
        // 有参数时，根据参数类型判断是否为类类型
        const [target, propertyKey] = props;
        const classType = getMetadata('design:type', target, propertyKey);
        const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
        data.push({ propertyKey, classType });
        defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
    } else {
        // 有参数时，根据参数类型判断是否为类类型
        return (target: object, propertyKey: string | symbol) => {
            const classType = props[0];
            const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
            data.push({ propertyKey, classType });
            defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
        };
    }
}

export function Init(): MethodDecorator {
    return (target, propertyKey) => defineMetadata(INIT_METADATA_KEY, propertyKey, target);
}

export function Prompt(path?: string): PropertyDecorator {
    return (target, propertyKey) => {
        const promptPath = join(ROOT_PATH, 'prompts', path || '');
        let value: string | object = '';
        if (statSync(promptPath).isDirectory()) {
            const paths = globSync(join(promptPath, '**/**.md'));
            value = {};
            paths.forEach(path => {
                const key = path.replace(promptPath, '').slice(1).replace(/\.md/, '').replace('/', '.');
                const prompt = readFileSync(path, 'utf-8');
                set(value as object, key, prompt);
            });
        } else if (existsSync(promptPath)) {
            value = readFileSync(promptPath, 'utf-8');
        }

        Object.defineProperty(target, propertyKey, { value, writable: false });
    };
}

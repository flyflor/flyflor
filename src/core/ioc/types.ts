export type ClassType<T = any> = new (...args: any[]) => T;

// 依赖注入元数据键
export const MODULE_METADATA_KEY = Symbol('MODULE_METADATA_KEY');
export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
export const INJECT_METADATA_INSTANCE_KEY = Symbol('INJECT_METADATA_INSTANCE_KEY');
export const TOOL_METADATA_KEY = Symbol('TOOL_METADATA_KEY');
export interface InjectMetadata {
    propertyKey: string | symbol;
    classType: ClassType;
    factoryArgs?: (this: any) => unknown | unknown[] | Promise<unknown | unknown[]>;
    scoped?: boolean;
}
export interface InjectInstanceMetadata {
    propertyKey: string | symbol;
    instance?: any;
}

// 提供器单例键
export const PROVIDER_SINGLETON_KEY = Symbol('PROVIDER_SINGLETON_KEY');

// 初始化装饰器，用于注册初始化方法
export const INIT_METADATA_KEY = Symbol('INIT_METADATA_KEY');

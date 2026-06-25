/**
 * EN: Constructor type used by IOC metadata and resolution.
 * ZH: IOC 元数据和解析使用的构造器类型。
 */
export type ClassType<T = any> = new (...args: any[]) => T;

// 依赖注入元数据键
export const MODULE_METADATA_KEY = Symbol('MODULE_METADATA_KEY');
export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
export const INJECT_METADATA_INSTANCE_KEY = Symbol('INJECT_METADATA_INSTANCE_KEY');
/**
 * EN: One property injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条属性注入记录。
 */
export interface InjectMetadata {
    propertyKey: string | symbol;
    classType: ClassType;
    factoryArgs?: (this: any) => unknown | unknown[] | Promise<unknown | unknown[]>;
    scoped?: boolean;
}
/**
 * EN: One early instance-injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条早期实例注入记录。
 */
export interface InjectInstanceMetadata {
    propertyKey: string | symbol;
    instance?: any;
}

// 提供器单例键
export const PROVIDER_SINGLETON_KEY = Symbol('PROVIDER_SINGLETON_KEY');

// 初始化装饰器，用于注册初始化方法
export const INIT_METADATA_KEY = Symbol('INIT_METADATA_KEY');

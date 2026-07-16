/**
 * ZH: IOC 元数据和解析使用的构造器类型。
 * EN: Constructor type used by IOC metadata and resolution.
 */
export type ClassType<T = object> = new (...args: never[]) => T;

/** ZH: module import 元数据使用的 Reflect key。 EN: Reflect key for module import metadata. */
export const MODULE_METADATA_KEY = Symbol('MODULE_METADATA_KEY');
/** ZH: property injection 元数据使用的 Reflect key。 EN: Reflect key for property injection metadata. */
export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
/** ZH: decorator 自有 instance factory 使用的 Reflect key。 EN: Reflect key for decorator-owned instance factories. */
export const INJECT_METADATA_INSTANCE_KEY = Symbol('INJECT_METADATA_INSTANCE_KEY');
/**
 * ZH: 存在于类构造器上的单条属性注入记录。
 * EN: One property injection record stored on a class constructor.
 */
export interface InjectMetadata {
    propertyKey: string | symbol;
    scoped: boolean;
}
/**
 * ZH: 存在于类构造器上的单条早期实例注入记录。
 * EN: One early instance-injection record stored on a class constructor.
 */
export interface InjectInstanceMetadata {
    propertyKey: string | symbol;
    instance: () => unknown | Promise<unknown>;
}

/** ZH: 标记 class 自有 singleton policy 的 Reflect key。 EN: Reflect key marking a class-owned singleton policy. */
export const PROVIDER_SINGLETON_KEY = Symbol('PROVIDER_SINGLETON_KEY');

/** ZH: 标记注入后生命周期方法名的 Reflect key。 EN: Reflect key naming the post-injection lifecycle method. */
export const INIT_METADATA_KEY = Symbol('INIT_METADATA_KEY');

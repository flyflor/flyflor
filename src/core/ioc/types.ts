/**
 * EN: Constructor type used by IOC metadata and resolution.
 * ZH: IOC 元数据和解析使用的构造器类型。
 */
export type ClassType<T = object> = new (...args: never[]) => T;

/** EN: Reflect key for module import metadata. ZH: module import 元数据使用的 Reflect key。 */
export const MODULE_METADATA_KEY = Symbol('MODULE_METADATA_KEY');
/** EN: Reflect key for property injection metadata. ZH: property injection 元数据使用的 Reflect key。 */
export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
/** EN: Reflect key for decorator-owned instance factories. ZH: decorator 自有 instance factory 使用的 Reflect key。 */
export const INJECT_METADATA_INSTANCE_KEY = Symbol('INJECT_METADATA_INSTANCE_KEY');
/**
 * EN: One property injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条属性注入记录。
 */
export interface InjectMetadata {
    propertyKey: string | symbol;
    scoped: boolean;
}
/**
 * EN: One early instance-injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条早期实例注入记录。
 */
export interface InjectInstanceMetadata {
    propertyKey: string | symbol;
    instance: () => unknown | Promise<unknown>;
}

/** EN: Reflect key marking a class-owned singleton policy. ZH: 标记 class 自有 singleton policy 的 Reflect key。 */
export const PROVIDER_SINGLETON_KEY = Symbol('PROVIDER_SINGLETON_KEY');

/** EN: Reflect key naming the post-injection lifecycle method. ZH: 标记注入后生命周期方法名的 Reflect key。 */
export const INIT_METADATA_KEY = Symbol('INIT_METADATA_KEY');

/**
 * EN: Constructor type used by IOC metadata and resolution.
 * ZH: IOC 元数据和解析使用的构造器类型。
 */
export type ClassType<T = any> = new (...args: any[]) => T;

/** EN: Metadata key storing one module's import graph. ZH: 保存单个 module import graph 的元数据键。 */
export const MODULE_METADATA_KEY = Symbol('MODULE_METADATA_KEY');
/** EN: Metadata key storing property injection records of a class. ZH: 保存类的属性注入记录的元数据键。 */
export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
/** EN: Metadata key storing early instance-injection records of a class. ZH: 保存类的早期实例注入记录的元数据键。 */
export const INJECT_METADATA_INSTANCE_KEY = Symbol('INJECT_METADATA_INSTANCE_KEY');
/**
 * EN: One property injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条属性注入记录。
 */
export interface InjectMetadata {
    /** EN: Property on the host instance that receives the injection. ZH: 接收注入的 host 实例属性。 */
    propertyKey: string | symbol;
    /** EN: Class constructed and injected into the property. ZH: 被构造并注入到该属性的类。 */
    classType: ClassType;
    /** EN: Optional host callback producing constructor args for the injected class. ZH: 可选的 host 回调，用于产出被注入类的构造参数。 */
    factoryArgs?: (this: any) => unknown | unknown[] | Promise<unknown | unknown[]>;
    /** EN: When true, constructor args are resolved from the current host scope. ZH: 为 true 时，构造参数从当前 host scope 解析。 */
    scoped?: boolean;
}
/**
 * EN: One early instance-injection record stored on a class constructor.
 * ZH: 存在于类构造器上的单条早期实例注入记录。
 */
export interface InjectInstanceMetadata {
    /** EN: Property on the host instance that receives the injected instance. ZH: 接收注入实例的 host 实例属性。 */
    propertyKey: string | symbol;
    /** EN: Host callback producing the instance to inject. ZH: 产出待注入实例的 host 回调。 */
    instance?: any;
}

/** EN: Metadata key marking a provider as singleton-cached. ZH: 标记 provider 进行 singleton 缓存的元数据键。 */
export const PROVIDER_SINGLETON_KEY = Symbol('PROVIDER_SINGLETON_KEY');

/** EN: Metadata key registering the `@Init()` lifecycle method of a class. ZH: 注册类 `@Init()` 生命周期方法的元数据键。 */
export const INIT_METADATA_KEY = Symbol('INIT_METADATA_KEY');

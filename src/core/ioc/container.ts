import { INIT_METADATA_KEY, INJECT_METADATA_INSTANCE_KEY, INJECT_METADATA_KEY, MODULE_METADATA_KEY, PROVIDER_SINGLETON_KEY, type ClassType, type InjectInstanceMetadata, type InjectMetadata } from './types';

const CONSTRUCTOR_PARAM_METADATA_KEY = 'design:paramtypes';

/**
 * EN: Singleton IOC container that owns project class construction and injection.
 * ZH: 负责项目 class 构造和注入的 singleton IOC container。
 */
export class Container {
    /**
     * 依赖注入容器单例实例
     */
    protected static instance: Container;
    /** EN: Singleton instance cache keyed by class or symbol. ZH: 按 class 或 symbol 索引的 singleton 实例缓存。 */
    public singletons!: Map<ClassType | symbol, InstanceType<ClassType>>;
    /** EN: Classes seen by the container during construction. ZH: container 构造过程中见过的 class 列表。 */
    public classList!: ClassType[];

    /**
     * EN: Creates or returns the process-wide container instance.
     * ZH: 创建或返回进程级 container 实例。
     */
    constructor() {
        if (Container.instance) return Container.instance;
        this.singletons = new Map();
        this.classList = [];
        Container.instance = this;
    }

    /**
     * EN: Resolves one class through the async IOC lifecycle.
     * ZH: 通过异步 IOC 生命周期解析一个 class。
     *
     * EN: `getAsync` is the single IOC construction entrypoint. Classes marked with `@Singleton()` are cached;
     * ordinary providers are constructed fresh on each call so stateful request objects do not leak across requests.
     * ZH: `getAsync` 是唯一 IOC 构造入口。`@Singleton()` class 会缓存；普通 provider 每次 fresh 构造，避免有状态请求对象跨请求泄漏。
     */
    public async getAsync<T extends ClassType, P extends unknown[]>(Module: T, ...props: P): Promise<InstanceType<T>> {
        if (!this.classList.includes(Module)) this.classList.push(Module);
        const isSingleton = getMetadata(PROVIDER_SINGLETON_KEY, Module) === true;
        if (isSingleton && this.singletons.has(Module)) return this.singletons.get(Module) as InstanceType<T>;
        const config = getMetadata(MODULE_METADATA_KEY, Module);
        if ((config?.imports || []).length !== 0) {
            for (const importModule of config.imports) {
                await this.getAsync(importModule);
            }
        }
        const constructorProps = this.getConstructorProps(Module, this.getModuleImportInstances(config?.imports || []), props);
        const clz = new Module(...constructorProps);
        if (isSingleton) this.singletons.set(Module, clz);
        try {
            /**
             * 提前注入 register 实例
             */
            const injectInstances: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, Module) || [];
            for (const inject of injectInstances) {
                const instance = await inject.instance?.call(clz);
                clz[inject.propertyKey] = instance;
            }
            /**
             * 通过 INJECT_METADATA_KEY 注入依赖
             * 为实例化 new Module
             */
            const injects: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, Module) || [];
            for (const inject of injects) {
                const resolvedProps = inject.scoped || !inject.factoryArgs ? undefined : await inject.factoryArgs.call(clz);
                const injectProps = inject.scoped
                    ? this.getScopedConstructorProps(inject.classType, clz, props)
                    : resolvedProps === undefined
                        ? []
                        : Array.isArray(resolvedProps)
                            ? resolvedProps
                            : [resolvedProps];
                const instance = await this.getAsync(inject.classType, ...injectProps);
                clz[inject.propertyKey] = instance;
            }
            /**
             * 判断是否有 @Init
             * 如果有 执行 @Init 方法
             */
            const actionPropertyKey = getMetadata(INIT_METADATA_KEY, Module.prototype);
            if (actionPropertyKey) await clz[actionPropertyKey]?.apply(clz, props);
            return clz;
        } catch (error) {
            if (isSingleton) this.singletons.delete(Module);
            throw error;
        }
    }

    /**
     * EN: Creates one IOC-owned instance without singleton registration.
     * ZH: 创建一个由 IOC 拥有但不注册 singleton 的实例。
     */
    public create<T extends ClassType, P extends unknown[]>(Module: T, ...props: P): InstanceType<T> {
        if (!this.classList.includes(Module)) this.classList.push(Module);
        return new Module(...props);
    }

    /**
     * EN: Returns already-built imported module instances for constructor injection.
     * ZH: 返回已构建的 imported module 实例，用于 constructor injection。
     */
    public getModuleImportInstances(imports: ClassType[]): Array<{ classType: ClassType; instance: InstanceType<ClassType> }> {
        return imports.filter((classType) => this.singletons.has(classType)).map((classType) => ({ classType, instance: this.singletons.get(classType) as InstanceType<ClassType> }));
    }

    /**
     * EN: Builds constructor args from explicit props and imported module instances.
     * ZH: 从显式 props 和 imported module 实例构造构造函数参数。
     */
    public getConstructorProps<P extends unknown[]>(Module: ClassType, importInstances: Array<{ classType: ClassType; instance: InstanceType<ClassType> }>, props: P): unknown[] {
        const paramTypes: ClassType[] = getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return props;
        return paramTypes.map((paramType, index) => {
            if (index < props.length) return props[index];
            const matched = importInstances.find((item) => item.classType === paramType);
            if (matched) return matched.instance;
            // JavaScript's constructor length excludes parameters with a
            // default value. Preserve that optional boundary instead of
            // treating a missing optional profile as a broken dependency.
            if (index >= Module.length) return undefined;
            throw Error(`Constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

    /**
     * EN: Builds constructor args for `@Scope()` injections from host-local values.
     * ZH: 从 host 本地值构造 `@Scope()` 注入所需参数。
     */
    private getScopedConstructorProps<P extends unknown[]>(Module: ClassType, host: object, props: P): unknown[] {
        const paramTypes: ClassType[] = getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return props;
        const scopedValues = this.getScopedValues(host, props);
        const used = new Set<number>();
        return paramTypes.map((paramType, index) => {
            const matchedIndex = this.getScopedValueIndex(scopedValues, paramType, used);
            if (matchedIndex >= 0) {
                used.add(matchedIndex);
                return scopedValues[matchedIndex];
            }
            const nextIndex = scopedValues.findIndex((_, valueIndex) => !used.has(valueIndex));
            if (nextIndex >= 0) {
                used.add(nextIndex);
                return scopedValues[nextIndex];
            }
            if (index < props.length) return props[index];
            if (index >= Module.length) return undefined;
            throw Error(`Scoped constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

    /**
     * EN: Collects current scope values from explicit props, injected properties, and host instance.
     * ZH: 从显式 props、已注入属性和 host 实例收集当前 scope 值。
     */
    private getScopedValues<P extends unknown[]>(host: object, props: P): unknown[] {
        const values = [...props];
        const injects: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, host.constructor) || [];
        for (const inject of injects) {
            const value = Reflect.get(host, inject.propertyKey);
            if (value !== undefined && !values.includes(value)) values.push(value);
        }
        if (!values.includes(host)) values.push(host);
        return values;
    }

    /**
     * EN: Finds the next unused scoped value matching a reflected class type.
     * ZH: 查找下一个匹配 reflected class type 且未使用的 scoped value。
     */
    private getScopedValueIndex(values: unknown[], paramType: ClassType, used: Set<number>): number {
        if (!this.isScopedClassType(paramType)) return -1;
        return values.findIndex((value, index) => !used.has(index) && value instanceof paramType);
    }

    /**
     * EN: Rejects primitive reflected constructor placeholders for scoped matching.
     * ZH: 在 scoped matching 中排除 primitive reflected constructor 占位类型。
     */
    private isScopedClassType(paramType: ClassType): boolean {
        return paramType !== Object
            && paramType !== String
            && paramType !== Number
            && paramType !== Boolean
            && paramType !== Array
            && paramType !== Function
            && paramType !== Promise;
    }

    /**
     * EN: Registers an existing object in the singleton map.
     * ZH: 把已有对象注册到 singleton map。
     */
    public registerObject(key: ClassType | symbol, instance: any) {
        this.singletons.set(key, instance);
        return this;
    }
}

/**
 * EN: Returns the process-wide IOC container singleton.
 * ZH: 返回进程级 IOC container singleton。
 */
export function useContainer() {
    return new Container();
}

/**
 * EN: Stores metadata used by decorators and the IOC container.
 * ZH: 保存 decorators 和 IOC container 使用的元数据。
 */
export function defineMetadata(metadataKey: any, metadataValue: any, target: Object): void;
/**
 * EN: Stores property-level metadata used by decorators and the IOC container.
 * ZH: 保存 decorators 和 IOC container 使用的属性级元数据。
 */
export function defineMetadata(metadataKey: any, metadataValue: any, target: Object, propertyKey: string | symbol): void;
/**
 * EN: Forwards metadata writes to `Reflect.defineMetadata`.
 * ZH: 将元数据写入转发给 `Reflect.defineMetadata`。
 */
export function defineMetadata(...props: any) {
    return Reflect.defineMetadata.apply(undefined, props);
}

/**
 * EN: Reads metadata used by decorators and the IOC container.
 * ZH: 读取 decorators 和 IOC container 使用的元数据。
 */
export function getMetadata(metadataKey: any, target: Object): any;
/**
 * EN: Reads property-level metadata used by decorators and the IOC container.
 * ZH: 读取 decorators 和 IOC container 使用的属性级元数据。
 */
export function getMetadata(metadataKey: any, target: Object, propertyKey: string | symbol): any;
/**
 * EN: Forwards metadata reads to `Reflect.getMetadata`.
 * ZH: 将元数据读取转发给 `Reflect.getMetadata`。
 */
export function getMetadata(...props: any): any {
    return Reflect.getMetadata.apply(undefined, props);
}

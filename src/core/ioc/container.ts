import 'reflect-metadata';
import { INIT_METADATA_KEY, INJECT_METADATA_INSTANCE_KEY, INJECT_METADATA_KEY, MODULE_METADATA_KEY, PROVIDER_SINGLETON_KEY, type ClassType, type InjectInstanceMetadata, type InjectMetadata } from './types';

const CONSTRUCTOR_PARAM_METADATA_KEY = 'design:paramtypes';

interface ResolutionScope {
    instances: Map<ClassType, InstanceType<ClassType>>;
    values: unknown[];
    host: object;
}

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
    /** EN: Singleton constructions currently in flight. ZH: 当前正在构造的 singleton。 */
    private pending!: Map<ClassType | symbol, Promise<InstanceType<ClassType>>>;
    /** EN: Classes seen by the container during construction. ZH: container 构造过程中见过的 class 列表。 */
    public classList!: ClassType[];

    /**
     * EN: Creates or returns the process-wide container instance.
     * ZH: 创建或返回进程级 container 实例。
     */
    constructor() {
        if (Container.instance) return Container.instance;
        this.singletons = new Map();
        this.pending = new Map();
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
        return await this.resolve(Module, props, undefined, false);
    }

    /**
     * EN: Resolves one class inside an optional Agent-local dependency scope.
     * ZH: 在可选的 Agent 本地依赖作用域中解析一个 class。
     */
    private async resolve<T extends ClassType, P extends unknown[]>(
        Module: T,
        props: P,
        scope: ResolutionScope | undefined,
        scoped: boolean,
    ): Promise<InstanceType<T>> {
        if (!this.classList.includes(Module)) this.classList.push(Module);
        const isSingleton = Reflect.getOwnMetadata(PROVIDER_SINGLETON_KEY, Module) === true;
        if (isSingleton && this.singletons.has(Module)) return this.singletons.get(Module) as InstanceType<T>;
        if (isSingleton && this.pending.has(Module)) return await this.pending.get(Module) as InstanceType<T>;
        if (scoped && scope?.instances.has(Module)) return scope.instances.get(Module) as InstanceType<T>;
        const construction = this.construct(Module, props, scope, scoped);
        if (!isSingleton) return await construction;
        this.pending.set(Module, construction);
        return await construction.finally(() => this.pending.delete(Module));
    }

    /**
     * EN: Constructs, injects, initializes, and only then publishes one object.
     * ZH: 构造、注入并初始化对象，完成后才发布该对象。
     */
    private async construct<T extends ClassType, P extends unknown[]>(
        Module: T,
        props: P,
        scope: ResolutionScope | undefined,
        scoped: boolean,
    ): Promise<InstanceType<T>> {
        const config = Reflect.getOwnMetadata(MODULE_METADATA_KEY, Module);
        for (const importModule of config?.imports || []) await this.resolve(importModule, [], undefined, false);
        const constructorProps = this.getConstructorProps(Module, this.getModuleImportInstances(config?.imports || []), props);
        const clz = new Module(...constructorProps);
        const localScope = scope ?? { instances: new Map(), values: [...props], host: clz };
        const injectInstances = this.collectMetadata<InjectInstanceMetadata>(Module, INJECT_METADATA_INSTANCE_KEY);
        for (const inject of injectInstances) {
            const instance = await inject.instance?.call(clz);
            clz[inject.propertyKey] = instance;
            if (instance !== undefined && !localScope.values.includes(instance)) localScope.values.push(instance);
        }
        const injects = this.collectMetadata<InjectMetadata>(Module, INJECT_METADATA_KEY);
        for (const inject of injects) {
            const classType = this.getInjectedType(Module, inject.propertyKey);
            const injectProps = inject.scoped
                ? this.getScopedConstructorProps(classType, [...localScope.values, localScope.host], props)
                : [];
            const instance = await this.resolve(classType, injectProps, inject.scoped ? localScope : undefined, inject.scoped);
            clz[inject.propertyKey] = instance;
            if (!localScope.values.includes(instance)) localScope.values.push(instance);
        }
        const actionPropertyKey = Reflect.getMetadata(INIT_METADATA_KEY, Module.prototype);
        if (actionPropertyKey) await clz[actionPropertyKey]?.apply(clz, props);
        if (Reflect.getOwnMetadata(PROVIDER_SINGLETON_KEY, Module) === true) this.singletons.set(Module, clz);
        if (scoped) localScope.instances.set(Module, clz);
        return clz;
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
        const paramTypes: ClassType[] = Reflect.getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return props;
        return paramTypes.map((paramType, index) => {
            if (index < props.length) return props[index];
            const matched = importInstances.find((item) => item.classType === paramType);
            if (matched) return matched.instance;
            throw Error(`Constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

    /**
     * EN: Builds constructor args for `@Scope()` injections from host-local values.
     * ZH: 从 host 本地值构造 `@Scope()` 注入所需参数。
     */
    private getScopedConstructorProps<P extends unknown[]>(Module: ClassType, values: unknown[], props: P): unknown[] {
        const paramTypes: ClassType[] = Reflect.getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return props;
        const used = new Set<number>();
        return paramTypes.map((paramType, index) => {
            const matchedIndex = this.getScopedValueIndex(values, paramType, used);
            if (matchedIndex >= 0) {
                used.add(matchedIndex);
                return values[matchedIndex];
            }
            const nextIndex = values.findIndex((_, valueIndex) => !used.has(valueIndex));
            if (nextIndex >= 0) {
                used.add(nextIndex);
                return values[nextIndex];
            }
            if (index < props.length) return props[index];
            throw Error(`Scoped constructor dependency not found: ${Module.name}[${index}]`);
        });
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
     * EN: Collects inherited member metadata without sharing mutable arrays between constructors.
     * ZH: 收集继承的成员元数据，同时避免构造器之间共享可变数组。
     */
    private collectMetadata<T extends { propertyKey: string | symbol }>(Module: ClassType, key: symbol): T[] {
        const constructors: ClassType[] = [];
        let current: unknown = Module;
        while (typeof current === 'function' && current !== Function.prototype) {
            constructors.unshift(current as ClassType);
            current = Object.getPrototypeOf(current);
        }
        const metadata = new Map<string | symbol, T>();
        for (const constructor of constructors) {
            const own = Reflect.getOwnMetadata(key, constructor) as T[] | undefined;
            for (const item of own || []) metadata.set(item.propertyKey, item);
        }
        return [...metadata.values()];
    }

    /**
     * EN: Reads and validates the reflected dependency type for one injected property.
     * ZH: 读取并验证一个注入属性的反射依赖类型。
     */
    private getInjectedType(Module: ClassType, propertyKey: string | symbol): ClassType {
        const classType = Reflect.getMetadata('design:type', Module.prototype, propertyKey) as ClassType | undefined;
        if (!classType || !this.isInjectableClassType(classType)) {
            throw Error(`Injected dependency type is invalid: ${Module.name}.${String(propertyKey)}`);
        }
        return classType;
    }

    /**
     * EN: Rejects erased and primitive reflected property types before construction.
     * ZH: 在构造前拒绝被擦除及原始类型的属性反射类型。
     */
    private isInjectableClassType(classType: ClassType): boolean {
        return this.isScopedClassType(classType) && classType !== Date && classType !== RegExp;
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

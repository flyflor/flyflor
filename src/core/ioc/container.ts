import 'reflect-metadata';
import { INIT_METADATA_KEY, INJECT_METADATA_INSTANCE_KEY, INJECT_METADATA_KEY, MODULE_METADATA_KEY, PROVIDER_SINGLETON_KEY, type ClassType, type InjectInstanceMetadata, type InjectMetadata } from './types';

const CONSTRUCTOR_PARAM_METADATA_KEY = 'design:paramtypes';

interface ResolutionScope {
    instances: Map<ClassType, InstanceType<ClassType>>;
    host: object;
}

/**
 * ZH: 负责项目 class 构造和注入的 singleton IOC container。
 * EN: Singleton IOC container that owns project class construction and injection.
 */
export class Container {
    /** ZH: 进程级 IOC container 实例。 EN: Process-wide IOC container instance. */
    protected static instance: Container;
    /** ZH: 按 class 或 symbol 索引的 singleton 实例缓存。 EN: Singleton instance cache keyed by class or symbol. */
    private readonly singletons!: Map<ClassType | symbol, InstanceType<ClassType>>;
    /** ZH: 当前正在构造的 singleton。 EN: Singleton constructions currently in flight. */
    private readonly pending!: Map<ClassType | symbol, Promise<InstanceType<ClassType>>>;

    /**
     * ZH: 创建或返回进程级 container 实例。
     * EN: Creates or returns the process-wide container instance.
     */
    public constructor() {
        if (Container.instance) return Container.instance;
        this.singletons = new Map();
        this.pending = new Map();
        Container.instance = this;
    }

    /**
     * ZH: 通过异步 IOC 生命周期解析一个 class。
     *
     * ZH: `getAsync` 是唯一 IOC 构造入口。`@Singleton()` class 会缓存；普通 provider 每次 fresh 构造，避免有状态请求对象跨请求泄漏。
     * EN: Resolves one class through the async IOC lifecycle.
     * EN: `getAsync` is the single IOC construction entrypoint. Classes marked with `@Singleton()` are cached;
     * ordinary providers are constructed fresh on each call so stateful request objects do not leak across requests.
     */
    public async getAsync<T extends ClassType, P extends unknown[]>(Module: T, ...props: P): Promise<InstanceType<T>> {
        return await this.resolve(Module, props, undefined, false);
    }

    /**
     * ZH: 在可选的 Agent 本地依赖作用域中解析一个 class。
     * EN: Resolves one class inside an optional Agent-local dependency scope.
     */
    private async resolve<T extends ClassType, P extends unknown[]>(
        Module: T,
        props: P,
        scope: ResolutionScope | undefined,
        scoped: boolean,
    ): Promise<InstanceType<T>> {
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
     * ZH: 构造、注入并初始化对象，完成后才发布该对象。
     * EN: Constructs, injects, initializes, and only then publishes one object.
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
        const clz = Reflect.construct(Module, constructorProps) as InstanceType<T>;
        const localScope = scope ?? { instances: new Map(), host: clz };
        const injectInstances = this.collectMetadata<InjectInstanceMetadata>(Module, INJECT_METADATA_INSTANCE_KEY);
        for (const inject of injectInstances) {
            const instance = await inject.instance.call(clz);
            clz[inject.propertyKey] = instance;
        }
        const injects = this.collectMetadata<InjectMetadata>(Module, INJECT_METADATA_KEY);
        for (const inject of injects) {
            const classType = this.getInjectedType(Module, inject.propertyKey);
            const injectProps = inject.scoped
                ? this.getScopedConstructorProps(classType, localScope)
                : [];
            const instance = await this.resolve(classType, injectProps, inject.scoped ? localScope : undefined, inject.scoped);
            clz[inject.propertyKey] = instance;
        }
        const actionPropertyKey = Reflect.getMetadata(INIT_METADATA_KEY, Module.prototype);
        if (actionPropertyKey) await clz[actionPropertyKey]?.apply(clz, props);
        if (Reflect.getOwnMetadata(PROVIDER_SINGLETON_KEY, Module) === true) this.singletons.set(Module, clz);
        if (scoped) localScope.instances.set(Module, clz);
        return clz;
    }

    /**
     * ZH: 创建一个由 IOC 拥有但不注册 singleton 的实例。
     * EN: Creates one IOC-owned instance without singleton registration.
     */
    public create<T extends ClassType, P extends unknown[]>(Module: T, ...props: P): InstanceType<T> {
        return Reflect.construct(Module, props) as InstanceType<T>;
    }

    /**
     * ZH: 返回已构建的 imported module 实例，用于 constructor injection。
     * EN: Returns already-built imported module instances for constructor injection.
     */
    private getModuleImportInstances(imports: ClassType[]): Array<{ classType: ClassType; instance: InstanceType<ClassType> }> {
        return imports.filter((classType) => this.singletons.has(classType)).map((classType) => ({ classType, instance: this.singletons.get(classType) as InstanceType<ClassType> }));
    }

    /**
     * ZH: 从显式 props 和 imported module 实例构造构造函数参数。
     * EN: Builds constructor args from explicit props and imported module instances.
     */
    private getConstructorProps<P extends unknown[]>(Module: ClassType, importInstances: Array<{ classType: ClassType; instance: InstanceType<ClassType> }>, props: P): unknown[] {
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
     * ZH: 从 host 本地值构造 `@Scope()` 注入所需参数。
     * EN: Builds constructor args for `@Scope()` injections from host-local values.
     */
    private getScopedConstructorProps(Module: ClassType, scope: ResolutionScope): unknown[] {
        const paramTypes: ClassType[] = Reflect.getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return [];
        return paramTypes.map((paramType, index) => {
            if (!this.isInjectableClassType(paramType)) {
                throw Error(`Scoped constructor dependency type is invalid: ${Module.name}[${index}]`);
            }
            if (scope.host instanceof paramType) return scope.host;
            const instance = scope.instances.get(paramType);
            if (instance) return instance;
            throw Error(`Scoped constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

    /**
     * ZH: 在 scoped matching 中排除 primitive reflected constructor 占位类型。
     * EN: Rejects primitive reflected constructor placeholders for scoped matching.
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
     * ZH: 收集继承的成员元数据，同时避免构造器之间共享可变数组。
     * EN: Collects inherited member metadata without sharing mutable arrays between constructors.
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
     * ZH: 读取并验证一个注入属性的反射依赖类型。
     * EN: Reads and validates the reflected dependency type for one injected property.
     */
    private getInjectedType(Module: ClassType, propertyKey: string | symbol): ClassType {
        const classType = Reflect.getMetadata('design:type', Module.prototype, propertyKey) as ClassType | undefined;
        if (!classType || !this.isInjectableClassType(classType)) {
            throw Error(`Injected dependency type is invalid: ${Module.name}.${String(propertyKey)}`);
        }
        return classType;
    }

    /**
     * ZH: 在构造前拒绝被擦除及原始类型的属性反射类型。
     * EN: Rejects erased and primitive reflected property types before construction.
     */
    private isInjectableClassType(classType: ClassType): boolean {
        return this.isScopedClassType(classType) && classType !== Date && classType !== RegExp;
    }

}

/**
 * ZH: 返回进程级 IOC container singleton。
 * EN: Returns the process-wide IOC container singleton.
 */
export function useContainer() {
    return new Container();
}

import { INIT_METADATA_KEY, INJECT_METADATA_INSTANCE_KEY, INJECT_METADATA_KEY, MODULE_METADATA_KEY, PROVIDER_SINGLETON_KEY, type ClassType, type InjectInstanceMetadata, type InjectMetadata } from './types';

const CONSTRUCTOR_PARAM_METADATA_KEY = 'design:paramtypes';

/**
 * 依赖注入容器类，用于管理应用程序的依赖注入 - 单例
 */
export class Container {
    /**
     * 依赖注入容器单例实例
     */
    protected static instance: Container;
    // 依赖注入容器实例缓存存储
    public singletons!: Map<ClassType | symbol, InstanceType<ClassType>>;
    // 注入的所有依赖
    public classList!: ClassType[];

    constructor() {
        if (Container.instance) return Container.instance;
        this.singletons = new Map();
        this.classList = [];
        Container.instance = this;
    }

    /**
     * 获取异步依赖注入容器实例。
     *
     * `getAsync` is the single IOC construction entrypoint. Classes marked with `@Singleton()` are cached;
     * ordinary providers are constructed fresh on each call so stateful request objects do not leak between turns.
     *
     * @param Module 依赖注入类类型
     * @param props 传给构造函数和 `@Init` 初始化钩子的兼容参数
     * @returns 依赖注入类实例
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

    public create<T extends ClassType, P extends unknown[]>(Module: T, ...props: P): InstanceType<T> {
        if (!this.classList.includes(Module)) this.classList.push(Module);
        return new Module(...props);
    }

    public getModuleImportInstances(imports: ClassType[]): Array<{ classType: ClassType; instance: InstanceType<ClassType> }> {
        return imports.filter((classType) => this.singletons.has(classType)).map((classType) => ({ classType, instance: this.singletons.get(classType) as InstanceType<ClassType> }));
    }

    public getConstructorProps<P extends unknown[]>(Module: ClassType, importInstances: Array<{ classType: ClassType; instance: InstanceType<ClassType> }>, props: P): unknown[] {
        const paramTypes: ClassType[] = getMetadata(CONSTRUCTOR_PARAM_METADATA_KEY, Module) || [];
        if (paramTypes.length === 0) return props;
        return paramTypes.map((paramType, index) => {
            if (index < props.length) return props[index];
            const matched = importInstances.find((item) => item.classType === paramType);
            if (matched) return matched.instance;
            throw Error(`Constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

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
            throw Error(`Scoped constructor dependency not found: ${Module.name}[${index}]`);
        });
    }

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

    private getScopedValueIndex(values: unknown[], paramType: ClassType, used: Set<number>): number {
        if (!this.isScopedClassType(paramType)) return -1;
        return values.findIndex((value, index) => !used.has(index) && value instanceof paramType);
    }

    private isScopedClassType(paramType: ClassType): boolean {
        return paramType !== Object
            && paramType !== String
            && paramType !== Number
            && paramType !== Boolean
            && paramType !== Array
            && paramType !== Function
            && paramType !== Promise;
    }

    public registerObject(key: ClassType | symbol, instance: any) {
        this.singletons.set(key, instance);
        return this;
    }
}

// 创建依赖注入容器实例
export function useContainer() {
    return new Container();
}

// 定义依赖注入容器元数据
export function defineMetadata(metadataKey: any, metadataValue: any, target: Object): void;
export function defineMetadata(metadataKey: any, metadataValue: any, target: Object, propertyKey: string | symbol): void;
export function defineMetadata(...props: any) {
    return Reflect.defineMetadata.apply(undefined, props);
}

// 获取依赖注入容器元数据
export function getMetadata(metadataKey: any, target: Object): any;
export function getMetadata(metadataKey: any, target: Object, propertyKey: string | symbol): any;
export function getMetadata(...props: any): any {
    return Reflect.getMetadata.apply(undefined, props);
}

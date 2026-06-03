import {
    INIT_METADATA_KEY,
    INJECT_METADATA_INSTANCE_KEY,
    INJECT_METADATA_KEY,
    MODULE_METADATA_KEY,
    PROVIDER_SINGLETON_KEY,
    type ClassType,
    type InjectInstanceMetadata,
    type InjectMetadata,
} from './types';

export interface InjectConfig {
    key?: string;
    propertyName: string;
    ClassType: ClassType;
}

export interface MetadataQueue {
    metadataKey: any;
    metadataValue: any;
    target: any;
    propertyKey?: string | symbol;
}

export const CONST_METADATA_KEY = 'CONST_METADATA_KEY';

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
     * 获取异步依赖注入容器实例
     *
     * @param Module 依赖注入类类型
     * @returns 依赖注入类实例
     */
    public async getAsync<T extends ClassType>(Module: T): Promise<InstanceType<T>> {
        if (!this.classList.includes(Module)) this.classList.push(Module);
        if (this.singletons.has(Module)) return this.singletons.get(Module) as InstanceType<T>;
        const config = getMetadata(MODULE_METADATA_KEY, Module);
        if ((config?.imports || []).length !== 0) {
            for (const importModule of config.imports) {
                await this.getAsync(importModule);
            }
        }
        const clz = new Module();
        this.singletons.set(Module, clz);
        try {
            /**
             * 提前注入 register 实例
             */
            const injectInstances: InjectInstanceMetadata[] = getMetadata(INJECT_METADATA_INSTANCE_KEY, Module) || getMetadata(INJECT_METADATA_INSTANCE_KEY, Module.prototype) || [];
            for (const inject of injectInstances) {
                const instance = await inject.instance?.();
                clz[inject.propertyKey] = instance;
            }
            /**
             * 通过 INJECT_METADATA_KEY 注入依赖
             * 为实例化 new Module
             */
            const injects: InjectMetadata[] = this.getInjectMetadata(Module);
            for (const inject of injects) {
                const instance = await this.getAsync(inject.classType);
                clz[inject.propertyKey] = instance;
            }
            /**
             * 判断是否有 @Init
             * 如果有 执行 @Init 方法
             */
            const actionPropertyKey = getMetadata(INIT_METADATA_KEY, Module.prototype) || getMetadata(INIT_METADATA_KEY, clz);
            if (actionPropertyKey) await clz[actionPropertyKey]?.apply(clz);
            return clz;
        } catch (error) {
            this.singletons.delete(Module);
            throw error;
        }
    }

    /**
     * Reads dependency metadata from the constructor first, then the prototype for compatibility with both
     * decorator storage styles. Duplicate property bindings keep the first declaration.
     *
     * @param Module 依赖注入类类型
     * @returns 去重后的属性注入元数据
     */
    private getInjectMetadata(Module: ClassType): InjectMetadata[] {
        const injects: InjectMetadata[] = [...(getMetadata(INJECT_METADATA_KEY, Module) || []), ...(getMetadata(INJECT_METADATA_KEY, Module.prototype) || [])];
        const unique: InjectMetadata[] = [];
        for (const inject of injects) {
            if (unique.some((item) => item.propertyKey === inject.propertyKey)) {
                continue;
            }
            unique.push(inject);
        }
        return unique;
    }

    /**
     * 获取依赖注入容器元数据
     *
     * @param metadataKey 元数据键名
     * @param target 元数据目标对象
     * @param propertyKey 元数据属性键名（可选）
     * @returns 元数据值
     */
    public getMetadata(metadataKey: any, target: Object): any;
    public getMetadata(metadataKey: any, target: Object, propertyKey: string | symbol): any;
    public getMetadata(): any {
        const [metadataKey, target, propertyKey] = arguments;
        return getMetadata(metadataKey, target, propertyKey);
    }

    /**
     * 定义依赖注入容器元数据
     *
     * @param metadataKey 元数据键名
     * @param metadataValue 元数据值
     * @param target 元数据目标对象
     * @param propertyKey 元数据属性键名（可选）
     */
    public defineMetadata(metadataKey: any, metadataValue: any, target: Object): void;
    public defineMetadata(metadataKey: any, metadataValue: any, target: Object, propertyKey: string | symbol): void;
    public defineMetadata(): void {
        const [metadataKey, metadataValue, target, propertyKey] = arguments;
        return defineMetadata(metadataKey, metadataValue, target, propertyKey);
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

export function getOwnMetadata(metadataKey: any, target: Object): any;
export function getOwnMetadata(metadataKey: any, target: Object, propertyKey: string | symbol): any;
export function getOwnMetadata(...props: any): any {
    return Reflect.getOwnMetadata.apply(undefined, props);
}

import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { useContainer } from './container';
import { Init, Inject, Module, Provide, Scope, Singleton } from '../decorator';
import { FModule, FService } from './abstracts';
import { Factory } from './factory';
import { INJECT_METADATA_KEY, type InjectMetadata } from './types';

/**
 * EN: ScopedSynapse class declaration.
 * ZH: ScopedSynapse class 声明。
 */
class ScopedSynapse {}

@Provide()
/** EN: Scoped child bound directly to its concrete host. ZH: 直接绑定到具体 host 的 scoped child。 */
class ScopedMemory {
    /** EN: Retains its exact scope host. ZH: 保留其精确 scope host。 */
    public constructor(public host: ScopedSynapse) {}
}

@Provide()
/** EN: Scoped child composed from its host and an already resolved child. ZH: 由 host 与已解析 child 组合的 scoped child。 */
class ScopedBrain {
    /** EN: Retains only concrete scoped constructor dependencies. ZH: 只保留具体 scoped constructor 依赖。 */
    public constructor(
        public host: ScopedSynapse,
        public memory: ScopedMemory,
    ) {}
}

@Provide()
/** EN: Concrete host exposing two isolated scoped children. ZH: 暴露两个隔离 scoped child 的具体 host。 */
class ScopedHost extends ScopedSynapse {
    @Scope()
    public memory!: ScopedMemory;

    @Scope()
    public brain!: ScopedBrain;
}

@Provide()
/** EN: Invalid scoped child whose constructor metadata erases to Object. ZH: 构造参数元数据被擦除为 Object 的非法 scoped child。 */
class ErasedScopedChild {
    /** EN: Accepts one erased dependency for rejection coverage. ZH: 接收一个用于拒绝覆盖的擦除依赖。 */
    public constructor(public readonly value: object) {}
}

@Provide()
/** EN: Host exposing one invalid erased scoped child. ZH: 暴露一个非法擦除 scoped child 的 host。 */
class ErasedScopedHost {
    @Scope()
    public child!: ErasedScopedChild;
}

/** EN: Reflected dependency fixture inherited by an injected host. ZH: 被注入 host 继承使用的反射依赖 fixture。 */
@Provide()
class ReflectedBaseDependency {}

/** EN: Reflected dependency fixture declared by a child host. ZH: 由子 host 声明的反射依赖 fixture。 */
@Provide()
class ReflectedChildDependency {}

/** EN: Base host declaring one reflected property dependency. ZH: 声明一个反射属性依赖的基础 host。 */
@Provide()
class ReflectedBaseHost {
    @Inject()
    public base!: ReflectedBaseDependency;
}

/** EN: Child host declaring metadata without mutating its base metadata. ZH: 声明自身元数据且不修改基础元数据的子 host。 */
@Provide()
class ReflectedChildHost extends ReflectedBaseHost {
    @Inject()
    public child!: ReflectedChildDependency;
}

/** EN: Invalid host whose dependency type is erased to Object. ZH: 依赖类型被擦除为 Object 的非法 host。 */
@Provide()
class ErasedDependencyHost {
    @Inject()
    public dependency!: object;
}

/** EN: Singleton base used to verify provider policy is class-owned. ZH: 用于验证 provider 策略由 class 自有的 singleton 基类。 */
@Singleton()
class SingletonBaseFixture {}

/** EN: Undecorated child that must not inherit singleton policy. ZH: 不得继承 singleton 策略的未装饰子类。 */
class TransientChildFixture extends SingletonBaseFixture {}

/** EN: Singleton lifecycle fixture initialized through a module import. ZH: 通过 module import 初始化的 singleton lifecycle fixture。 */
@Singleton()
class LivingSingleton extends FService {
    public static initCount = 0;

    /** EN: Records one successful singleton initialization. ZH: 记录一次成功 singleton 初始化。 */
    @Init()
    public init(): void {
        LivingSingleton.initCount += 1;
    }
}

/** EN: Root fixture for Factory lifecycle verification. ZH: 用于 Factory lifecycle 验证的根 fixture。 */
@Module({ imports: [LivingSingleton] })
class LivingModule extends FModule {}

/** EN: Singleton fixture whose initialization always rejects. ZH: 初始化始终 reject 的 singleton fixture。 */
@Singleton()
class FailingSingleton extends FService {
    public static attempts = 0;

    /** EN: Rejects after recording each unpublished construction. ZH: 记录每次未发布构造后 reject。 */
    @Init()
    public init(): void {
        FailingSingleton.attempts += 1;
        throw Error('init failed');
    }
}

describe('@Scope', () => {
    test('resolves only the concrete host and already built scoped instances', async () => {
        const host = await useContainer().getAsync(ScopedHost);
        const other = await useContainer().getAsync(ScopedHost);

        expect(host.memory.host).toBe(host);
        expect(host.brain.host).toBe(host);
        expect(host.brain.memory).toBe(host.memory);
        expect(other.memory.host).toBe(other);
        expect(other.memory).not.toBe(host.memory);
    });

    test('rejects erased scoped constructor dependency types', async () => {
        await expect(useContainer().getAsync(ErasedScopedHost)).rejects.toThrow('ErasedScopedChild[0]');
    });
});

describe('@Inject', () => {
    test('resolves design:type while isolating inherited metadata arrays', async () => {
        const host = await useContainer().getAsync(ReflectedChildHost);
        const base = Reflect.getOwnMetadata(INJECT_METADATA_KEY, ReflectedBaseHost) as InjectMetadata[];
        const child = Reflect.getOwnMetadata(INJECT_METADATA_KEY, ReflectedChildHost) as InjectMetadata[];

        expect(host.base).toBeInstanceOf(ReflectedBaseDependency);
        expect(host.child).toBeInstanceOf(ReflectedChildDependency);
        expect(base.map((inject) => inject.propertyKey)).toEqual(['base']);
        expect(child.map((inject) => inject.propertyKey)).toEqual(['child']);
    });

    test('rejects erased reflected property types with owner and property', async () => {
        await expect(useContainer().getAsync(ErasedDependencyHost)).rejects.toThrow('ErasedDependencyHost.dependency');
    });

    test('does not inherit singleton policy from a decorated base class', async () => {
        const first = await useContainer().getAsync(TransientChildFixture);
        const second = await useContainer().getAsync(TransientChildFixture);

        expect(first).not.toBe(second);
    });
});

describe('IOC lifecycle', () => {
    test('Factory initializes a module graph and singleton only once', async () => {
        const first = await Factory.create(LivingModule);
        const second = await Factory.create(LivingModule);

        expect(first).toBe(second);
        expect(LivingSingleton.initCount).toBe(1);
    });

    test('does not publish a singleton whose Init rejects', async () => {
        await expect(useContainer().getAsync(FailingSingleton)).rejects.toThrow('init failed');
        await expect(useContainer().getAsync(FailingSingleton)).rejects.toThrow('init failed');

        expect(FailingSingleton.attempts).toBe(2);
    });
});

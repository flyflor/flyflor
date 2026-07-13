import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { useContainer } from './container';
import { Init, Inject, Module, Provide, Scope, Singleton } from '../decorator';
import { FModule, FService } from './abstracts';
import { Factory } from './factory';
import { INJECT_METADATA_KEY, type InjectMetadata } from './types';

/**
 * EN: ScopedConfig interface declaration.
 * ZH: ScopedConfig interface 声明。
 */
interface ScopedConfig {
    name: string;
}

/**
 * EN: ScopedSynapse class declaration.
 * ZH: ScopedSynapse class 声明。
 */
class ScopedSynapse {}

/**
 * EN: ScopedAtom class declaration.
 * ZH: ScopedAtom class 声明。
 */
class ScopedAtom {
    constructor(
        public config: ScopedConfig,
        public synapse: ScopedSynapse,
    ) {}
}

@Provide()
/**
 * EN: ScopedMemory class declaration.
 * ZH: ScopedMemory class 声明。
 */
class ScopedMemory extends ScopedAtom {}

@Provide()
/**
 * EN: ScopedBrain class declaration.
 * ZH: ScopedBrain class 声明。
 */
class ScopedBrain extends ScopedAtom {
    constructor(
        public override config: ScopedConfig,
        public override synapse: ScopedSynapse,
        public memory: ScopedMemory,
    ) {
        super(config, synapse);
    }
}

@Provide()
/**
 * EN: ObjectMetadataBrain class declaration.
 * ZH: ObjectMetadataBrain class 声明。
 */
class ObjectMetadataBrain {
    constructor(
        public config: object,
        public synapse: object,
        public memory: object,
    ) {}
}

@Provide()
/**
 * EN: ScopedHost class declaration.
 * ZH: ScopedHost class 声明。
 */
class ScopedHost extends ScopedAtom {
    @Scope()
    public memory!: ScopedMemory;

    @Scope()
    public brain!: ScopedBrain;
}

@Provide()
/**
 * EN: ObjectMetadataHost class declaration.
 * ZH: ObjectMetadataHost class 声明。
 */
class ObjectMetadataHost extends ScopedAtom {
    public filters: Set<unknown>;

    public values: unknown[];

    /** EN: Initializes test-owned collections with the scoped host. ZH: 随 scoped host 初始化测试集合。 */
    public constructor(config: ScopedConfig, synapse: ScopedSynapse) {
        super(config, synapse);
        this.filters = new Set();
        this.values = [];
    }

    @Scope()
    public memory!: ScopedMemory;

    @Scope()
    public brain!: ObjectMetadataBrain;
}

@Provide()
/**
 * EN: ScopedHostChild class declaration.
 * ZH: ScopedHostChild class 声明。
 */
class ScopedHostChild {
    constructor(public host: object) {}
}

@Provide()
/**
 * EN: ScopedHostWithChild class declaration.
 * ZH: ScopedHostWithChild class 声明。
 */
class ScopedHostWithChild {
    @Scope()
    public child!: ScopedHostChild;
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
    test('resolves constructor args from the host scope', async () => {
        const config = { name: 'flyflor' };
        const synapse = new ScopedSynapse();
        const host = await useContainer().getAsync(ScopedHost, config, synapse);

        expect(host.memory.config).toBe(config);
        expect(host.memory.synapse).toBe(synapse);
        expect(host.brain.config).toBe(config);
        expect(host.brain.synapse).toBe(synapse);
        expect(host.brain.memory).toBe(host.memory);
    });

    test('passes host values when constructor metadata is erased to Object', async () => {
        const config = { name: 'flyflor' };
        const synapse = new ScopedSynapse();
        const host = await useContainer().getAsync(ObjectMetadataHost, config, synapse);

        expect(host.brain.config).toBe(config);
        expect(host.brain.synapse).toBe(synapse);
        expect(host.brain.memory).toBe(host.memory);
    });

    test('passes the host instance to scoped child constructors', async () => {
        const host = await useContainer().getAsync(ScopedHostWithChild);

        expect(host.child.host).toBe(host);
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
        expect(useContainer().singletons.has(FailingSingleton)).toBe(false);
    });
});

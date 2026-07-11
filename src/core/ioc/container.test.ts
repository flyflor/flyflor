import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { defineMetadata, getMetadata, useContainer } from './container';
import { INJECT_METADATA_KEY, type ClassType, type InjectMetadata } from './types';
import { Init, Module, Singleton } from '../decorator';
import { FModule, FService } from './abstracts';
import { Factory } from './factory';

/**
 * EN: Provide function declaration.
 * ZH: Provide function 声明。
 */
function Provide(): ClassDecorator {
    return () => {};
}

/**
 * EN: Scope function declaration.
 * ZH: Scope function 声明。
 */
function Scope(): PropertyDecorator {
    return (target, propertyKey) => {
        const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
        data.push({ propertyKey, classType: getMetadata('design:type', target, propertyKey) as ClassType, scoped: true });
        defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
    };
}

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

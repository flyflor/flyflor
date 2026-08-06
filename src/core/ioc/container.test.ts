import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { defineMetadata, getMetadata, useContainer } from './container';
import { INJECT_METADATA_KEY, type ClassType, type InjectMetadata } from './types';

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
 * EN: ScopedRuntime class declaration.
 * ZH: ScopedRuntime class 声明。
 */
class ScopedRuntime {}

/**
 * EN: ScopedAtom class declaration.
 * ZH: ScopedAtom class 声明。
 */
class ScopedAtom {
    constructor(
        public config: ScopedConfig,
        public runtime: ScopedRuntime,
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
        public override runtime: ScopedRuntime,
        public memory: ScopedMemory,
    ) {
        super(config, runtime);
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
        public runtime: object,
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
    public filters = new Set();

    public values: unknown[] = [];

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

describe('@Scope', () => {
    test('resolves constructor args from the host scope', async () => {
        const config = { name: 'flyflor' };
        const runtime = useContainer().create(ScopedRuntime);
        const host = await useContainer().getAsync(ScopedHost, config, runtime);

        expect(host.memory.config).toBe(config);
        expect(host.memory.runtime).toBe(runtime);
        expect(host.brain.config).toBe(config);
        expect(host.brain.runtime).toBe(runtime);
        expect(host.brain.memory).toBe(host.memory);
    });

    test('passes host values when constructor metadata is erased to Object', async () => {
        const config = { name: 'flyflor' };
        const runtime = useContainer().create(ScopedRuntime);
        const host = await useContainer().getAsync(ObjectMetadataHost, config, runtime);

        expect(host.brain.config).toBe(config);
        expect(host.brain.runtime).toBe(runtime);
        expect(host.brain.memory).toBe(host.memory);
    });

    test('passes the host instance to scoped child constructors', async () => {
        const host = await useContainer().getAsync(ScopedHostWithChild);

        expect(host.child.host).toBe(host);
    });
});

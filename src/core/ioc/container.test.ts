import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { defineMetadata, getMetadata, useContainer } from './container';
import { INJECT_METADATA_KEY, type ClassType, type InjectMetadata } from './types';

function Provide(): ClassDecorator {
    return () => {};
}

function Scope(): PropertyDecorator {
    return (target, propertyKey) => {
        const data: InjectMetadata[] = getMetadata(INJECT_METADATA_KEY, target.constructor) || [];
        data.push({ propertyKey, classType: getMetadata('design:type', target, propertyKey) as ClassType, scoped: true });
        defineMetadata(INJECT_METADATA_KEY, data, target.constructor);
    };
}

interface ScopedConfig {
    name: string;
}

class ScopedSynapse {}

class ScopedAtom {
    constructor(
        public config: ScopedConfig,
        public synapse: ScopedSynapse,
    ) {}
}

@Provide()
class ScopedMemory extends ScopedAtom {}

@Provide()
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
class ObjectMetadataBrain {
    constructor(
        public config: object,
        public synapse: object,
        public memory: object,
    ) {}
}

@Provide()
class ScopedHost extends ScopedAtom {
    @Scope()
    public memory!: ScopedMemory;

    @Scope()
    public brain!: ScopedBrain;
}

@Provide()
class ObjectMetadataHost extends ScopedAtom {
    public filters = new Set();

    public values: unknown[] = [];

    @Scope()
    public memory!: ScopedMemory;

    @Scope()
    public brain!: ObjectMetadataBrain;
}

@Provide()
class ScopedHostChild {
    constructor(public host: object) {}
}

@Provide()
class ScopedHostWithChild {
    @Scope()
    public child!: ScopedHostChild;
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

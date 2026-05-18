/**
 * Component identity base classes.
 *
 * These classes intentionally contain no business logic. They exist so DI
 * metadata can infer component kind/layer by `instanceof` without reflection
 * metadata or string tokens.
 */
export abstract class FlyflorComponent {
    public get componentName(): string {
        return this.constructor.name;
    }
}

export abstract class Gateway extends FlyflorComponent {}

export abstract class Blackboard extends FlyflorComponent {}

export abstract class Runtime extends FlyflorComponent {}

export abstract class Memory extends FlyflorComponent {}

export abstract class Sandbox extends FlyflorComponent {}

export abstract class CapabilityComponent extends FlyflorComponent {}

export abstract class ContextComponent extends FlyflorComponent {}

export abstract class BrainComponent extends FlyflorComponent {}

export abstract class GraphComponent extends FlyflorComponent {}

export abstract class SQLiteComponent extends FlyflorComponent {}

export abstract class RedisComponent extends FlyflorComponent {}

export abstract class SurrealComponent extends FlyflorComponent {}

export abstract class MemoryComponent extends Memory {}

export abstract class CrystalComponent extends FlyflorComponent {}

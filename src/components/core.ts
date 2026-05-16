/**
 * Component identity base classes.
 *
 * These classes intentionally contain no business logic. They exist so DI
 * metadata can infer component kind/layer by `instanceof` without reflection
 * metadata or string tokens.
 */
export abstract class CoreComponent {
    public get componentName(): string {
        return this.constructor.name;
    }
}

export abstract class Gateway extends CoreComponent {}

export abstract class Blackboard extends CoreComponent {}

export abstract class Runtime extends CoreComponent {}

export abstract class Memory extends CoreComponent {}

export abstract class Sandbox extends CoreComponent {}

export abstract class BrainComponent extends CoreComponent {}

export abstract class GraphComponent extends CoreComponent {}

export abstract class SQLiteComponent extends CoreComponent {}

export abstract class MemoryComponent extends Memory {}

export abstract class CrystalComponent extends CoreComponent {}

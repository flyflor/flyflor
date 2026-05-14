/**
 * Core inheritance marker for all runtime components.
 *
 * Decorators carry DI metadata; this base class carries only boundary identity
 * so components can share a common type without inheriting hidden behavior.
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

export abstract class MemoryComponent extends Memory {}

export abstract class CrystalComponent extends CoreComponent {}

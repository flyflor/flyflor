/**
 * Represents a constructor that can be managed by the Flyflor DI registry.
 *
 * @typeParam T - Instance type produced by the constructor.
 * @param args - Constructor arguments supplied by future container resolution.
 * @returns A class instance of `T`.
 * @usage Use this type for provider classes, module imports, and explicit injection targets.
 */
export interface Constructor<T = unknown> {
  new (...args: never[]): T;
}

/**
 * Represents a stable dependency injection token.
 *
 * @typeParam T - Runtime value type associated with the token.
 * @usage Use classes for normal injection and symbols for abstract or external values.
 */
export type InjectionToken<T = unknown> = Constructor<T> | symbol;

/**
 * Describes a class registered through `@Provide`, `@Service`, `@Component`, or `@Repo`.
 *
 * @property target - Concrete class managed by the project DI system.
 * @property token - Public token used to resolve the provider.
 * @property kind - Semantic provider category used by conventions and diagnostics.
 * @usage Read by the future DI container during module bootstrap.
 */
export interface ProviderMetadata {
  readonly target: Constructor;
  readonly token: InjectionToken;
  readonly kind: ProviderKind;
}

/**
 * Describes a module declared through `@Module`.
 *
 * @property imports - Other modules that must be bootstrapped before this module.
 * @property providers - Provider classes owned by this module.
 * @property exports - Provider tokens or classes exposed to importing modules.
 * @property bootstrap - Providers eagerly resolved by `createContainer` so their `@Subscribe` listeners and `init()` hooks are live without an explicit `resolve`.
 * @usage Read by the future DI container during module bootstrap.
 */
export interface ModuleMetadata {
  readonly imports: readonly Constructor[];
  readonly providers: readonly Constructor[];
  readonly exports: readonly InjectionToken[];
  readonly bootstrap: readonly Constructor[];
}

/**
 * Options accepted by the `@Module` decorator.
 *
 * @property imports - Module classes this module depends on.
 * @property providers - Provider classes assembled by this module.
 * @property exports - Provider tokens or classes made visible to importers.
 * @property bootstrap - Providers `createContainer` must eagerly resolve so their `@Subscribe` listeners attach under the real executable path (e.g. `SandboxGuard`).
 * @usage Keep module declarations convention-first and avoid large configuration objects.
 */
export interface ModuleOptions {
  readonly imports?: readonly Constructor[];
  readonly providers?: readonly Constructor[];
  readonly exports?: readonly InjectionToken[];
  readonly bootstrap?: readonly Constructor[];
}

/**
 * Describes one property injection declared through `@Inject`.
 *
 * @property propertyKey - Class property that should receive the dependency.
 * @property token - Explicit dependency token or class to resolve.
 * @usage Applied after a provider instance is constructed by the future container.
 */
export interface InjectionMetadata {
  readonly propertyKey: string | symbol;
  readonly token: InjectionToken;
}

/**
 * Describes one prompt injection declared through `@Prompt`.
 *
 * @property propertyKey - Class property that should receive prompt text.
 * @property relativePath - Prompt path relative to the declaring source file or project root by convention.
 * @usage Used by the future prompt loader; runtime must load `.md`, not `.zh.cn.md`.
 */
export interface PromptMetadata {
  readonly propertyKey: string | symbol;
  readonly relativePath: string;
}

/**
 * Describes one signal subscription declared through `@Subscribe`.
 *
 * @property methodKey - Method that will handle the signal payload.
 * @property signalName - Runtime signal name handled by the method.
 * @usage The future DI lifecycle reads this metadata and registers handlers on `SignalBus`.
 */
export interface SubscriptionMetadata {
  readonly methodKey: string | symbol;
  readonly signalName: string;
}

/**
 * Identifies the semantic category of a DI-managed class.
 *
 * @usage Diagnostics and conventions use this value; it is not a runtime scope system.
 */
export enum ProviderKind {
  Provide = "provide",
  Service = "service",
  Component = "component",
  Repo = "repo",
  Plugin = "plugin",
}

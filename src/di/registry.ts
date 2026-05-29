import { ProviderKind, type Constructor, type InjectionMetadata, type InjectionToken, type ModuleMetadata, type ModuleOptions, type PromptMetadata, type ProviderMetadata, type SubscriptionMetadata } from "./types";

const moduleMetadataStore = new WeakMap<Constructor, ModuleMetadata>();
const providerMetadataStore = new WeakMap<Constructor, ProviderMetadata>();
const injectionMetadataStore = new WeakMap<Constructor, InjectionMetadata[]>();
const promptMetadataStore = new WeakMap<Constructor, PromptMetadata[]>();
const subscriptionMetadataStore = new WeakMap<Constructor, SubscriptionMetadata[]>();

/**
 * Stores and reads decorator metadata for the project-owned DI system.
 *
 * @usage Decorators write to this registry; the future container bootstrapper reads from it.
 */
export class DecoratorRegistry {
  /**
   * Records metadata for a module class.
   *
   * @param target - Module class decorated by `@Module`.
   * @param options - Module assembly options supplied by the decorator.
   * @returns Nothing; metadata is kept in an internal `WeakMap`.
   * @usage Called only by the `@Module` decorator.
   */
  public setModule(target: Constructor, options: ModuleOptions): void {
    moduleMetadataStore.set(target, {
      imports: options.imports ?? [],
      providers: options.providers ?? [],
      exports: options.exports ?? [],
    });
  }

  /**
   * Reads metadata for a module class.
   *
   * @param target - Module class to inspect.
   * @returns Module metadata when present, otherwise `undefined`.
   * @usage Used by bootstrap diagnostics and future module loading.
   */
  public getModule(target: Constructor): ModuleMetadata | undefined {
    return moduleMetadataStore.get(target);
  }

  /**
   * Records metadata for a provider class.
   *
   * @param target - Concrete class being registered.
   * @param token - Public token used to resolve the provider.
   * @param kind - Semantic provider category.
   * @returns Nothing; metadata is kept in an internal `WeakMap`.
   * @usage Called by provider-like decorators.
   */
  public setProvider(target: Constructor, token: InjectionToken, kind: ProviderKind): void {
    providerMetadataStore.set(target, { target, token, kind });
  }

  /**
   * Reads metadata for a provider class.
   *
   * @param target - Provider class to inspect.
   * @returns Provider metadata when present, otherwise `undefined`.
   * @usage Used by future DI registration.
   */
  public getProvider(target: Constructor): ProviderMetadata | undefined {
    return providerMetadataStore.get(target);
  }

  /**
   * Records a property injection for a class.
   *
   * @param target - Class prototype receiving the injected property.
   * @param propertyKey - Property name or symbol that should receive the dependency.
   * @param token - Explicit dependency token or class.
   * @returns Nothing; metadata is appended for the declaring constructor.
   * @usage Called only by `@Inject`.
   */
  public addInjection(target: object, propertyKey: string | symbol, token: InjectionToken): void {
    const constructor = target.constructor as Constructor;
    const injections = injectionMetadataStore.get(constructor) ?? [];
    injections.push({ propertyKey, token });
    injectionMetadataStore.set(constructor, injections);
  }

  /**
   * Reads property injections for a class.
   *
   * @param target - Class to inspect.
   * @returns Injection metadata declared on the class.
   * @usage Used after instance construction by the future container.
   */
  public getInjections(target: Constructor): readonly InjectionMetadata[] {
    return injectionMetadataStore.get(target) ?? [];
  }

  /**
   * Records a prompt injection for a class.
   *
   * @param target - Class prototype receiving prompt text.
   * @param propertyKey - Property name or symbol that should receive the prompt text.
   * @param relativePath - Prompt path supplied to `@Prompt`.
   * @returns Nothing; metadata is appended for the declaring constructor.
   * @usage Called only by `@Prompt`.
   */
  public addPrompt(target: object, propertyKey: string | symbol, relativePath: string): void {
    const constructor = target.constructor as Constructor;
    const prompts = promptMetadataStore.get(constructor) ?? [];
    prompts.push({ propertyKey, relativePath });
    promptMetadataStore.set(constructor, prompts);
  }

  /**
   * Reads prompt injections for a class.
   *
   * @param target - Class to inspect.
   * @returns Prompt metadata declared on the class.
   * @usage Used by the future prompt loader.
   */
  public getPrompts(target: Constructor): readonly PromptMetadata[] {
    return promptMetadataStore.get(target) ?? [];
  }

  /**
   * Records a signal subscription for a class method.
   *
   * @param target - Class prototype declaring the subscriber method.
   * @param methodKey - Method name or symbol that handles the signal.
   * @param signalName - Signal name supplied to `@Subscribe`.
   * @returns Nothing; metadata is appended for the declaring constructor.
   * @usage Called only by `@Subscribe`.
   */
  public addSubscription(target: object, methodKey: string | symbol, signalName: string): void {
    const constructor = target.constructor as Constructor;
    const subscriptions = subscriptionMetadataStore.get(constructor) ?? [];
    subscriptions.push({ methodKey, signalName });
    subscriptionMetadataStore.set(constructor, subscriptions);
  }

  /**
   * Reads signal subscriptions for a class.
   *
   * @param target - Class to inspect.
   * @returns Subscription metadata declared on the class.
   * @usage Used by future lifecycle wiring against `SignalBus`.
   */
  public getSubscriptions(target: Constructor): readonly SubscriptionMetadata[] {
    return subscriptionMetadataStore.get(target) ?? [];
  }
}

/**
 * Shared decorator metadata registry used by all Flyflor decorators.
 *
 * @usage Import this singleton in diagnostics, tests, and the future DI bootstrapper.
 */
export const decoratorRegistry = new DecoratorRegistry();

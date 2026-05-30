import { decoratorRegistry } from "./registry";
import { ProviderKind, type Constructor, type InjectionToken, type ModuleOptions } from "./types";

/**
 * Declares a DI module boundary.
 *
 * @param options - Module imports, providers, and exports owned by this module.
 * @returns A class decorator that records module metadata.
 * @usage Use on classes that assemble providers; keep business logic out of module classes.
 */
export function Module(options: ModuleOptions): FlyflorClassDecorator {
  return (target: object) => {
    decoratorRegistry.setModule(target as unknown as Constructor, options);
  };
}

/**
 * Registers a class as a provider with an optional explicit base token.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated class.
 * @returns A class decorator that records provider metadata.
 * @usage Use `@Provide(Base)` for explicit base binding and `@Provide()` for self binding.
 */
export function Provide(base?: InjectionToken): FlyflorClassDecorator {
  return createProviderDecorator(ProviderKind.Provide, base);
}

/**
 * Registers a class as a business or orchestration service.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated service.
 * @returns A class decorator that records service provider metadata.
 * @usage Use on runtime capabilities such as agent orchestration, tool calls, and memory distillation.
 */
export function Service(base?: InjectionToken): FlyflorClassDecorator {
  return createProviderDecorator(ProviderKind.Service, base);
}

/**
 * Registers a class as an infrastructure component.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated component.
 * @returns A class decorator that records component provider metadata.
 * @usage Use on database, memory, context, model, and prompt-loading infrastructure classes.
 */
export function Component(base?: InjectionToken): FlyflorClassDecorator {
  return createProviderDecorator(ProviderKind.Component, base);
}

/**
 * Registers a class as a repository for data model and SQL operations.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated repo.
 * @returns A class decorator that records repo provider metadata.
 * @usage Use under `src/entities` for persistence-facing model classes.
 */
export function Repo(base?: InjectionToken): FlyflorClassDecorator {
  return createProviderDecorator(ProviderKind.Repo, base);
}

/**
 * Declares an explicit property injection.
 *
 * @param token - Class or symbol token to resolve for the property.
 * @returns A property decorator that records injection metadata.
 * @usage Use as `@Inject(ConfigService) public config!: ConfigService`; implicit type reflection is forbidden in v1.
 */
export function Inject(token: InjectionToken) {
  return (target: object | undefined, propertyKeyOrContext: string | symbol | StandardDecoratorContextLike) => {
    if (isStandardDecoratorContext(propertyKeyOrContext)) {
      appendStandardMetadata(propertyKeyOrContext, "injections", { propertyKey: propertyKeyOrContext.name, token });
      propertyKeyOrContext.addInitializer?.(function injectInitializer(this: object) {
        decoratorRegistry.addInjection(this, propertyKeyOrContext.name, token);
      });
      return;
    }
    if (!target) {
      throw new Error(`@Inject requires an instance property: ${String(propertyKeyOrContext)}`);
    }
    decoratorRegistry.addInjection(target, propertyKeyOrContext, token);
  };
}

/**
 * Declares that a property should receive prompt text from a prompt file.
 *
 * @param relativePath - Relative prompt path, normally under `prompts` and ending with `.md`.
 * @returns A property decorator that records prompt injection metadata.
 * @usage Use as `@Prompt("./prompts/system.md") public systemPrompt!: string`.
 */
export function Prompt(relativePath: string) {
  return (target: object | undefined, propertyKeyOrContext: string | symbol | StandardDecoratorContextLike) => {
    if (isStandardDecoratorContext(propertyKeyOrContext)) {
      appendStandardMetadata(propertyKeyOrContext, "prompts", { propertyKey: propertyKeyOrContext.name, relativePath });
      propertyKeyOrContext.addInitializer?.(function promptInitializer(this: object) {
        decoratorRegistry.addPrompt(this, propertyKeyOrContext.name, relativePath);
      });
      return;
    }
    if (!target) {
      throw new Error(`@Prompt requires an instance property: ${String(propertyKeyOrContext)}`);
    }
    decoratorRegistry.addPrompt(target, propertyKeyOrContext, relativePath);
  };
}

/**
 * Declares that a method subscribes to a runtime signal.
 *
 * @param signalName - Signal name that the decorated method handles.
 * @returns A method decorator that records subscription metadata.
 * @usage Use on instance methods that will be wired to `SignalBus` after DI construction.
 */
export function Subscribe(signalName: string) {
  return (target: object, propertyKeyOrContext: string | symbol | StandardDecoratorContextLike) => {
    if (isStandardDecoratorContext(propertyKeyOrContext)) {
      appendStandardMetadata(propertyKeyOrContext, "subscriptions", { methodKey: propertyKeyOrContext.name, signalName });
      propertyKeyOrContext.addInitializer?.(function subscribeInitializer(this: object) {
        decoratorRegistry.addSubscription(this, propertyKeyOrContext.name, signalName);
      });
      return;
    }
    decoratorRegistry.addSubscription(target, propertyKeyOrContext, signalName);
  };
}

/**
 * Builds provider-like decorators that share the same binding convention.
 *
 * @param kind - Semantic provider category written to metadata.
 * @param base - Optional explicit token that maps to the decorated class.
 * @returns A class decorator that records the provider metadata.
 * @usage Internal helper for `@Provide`, `@Service`, `@Component`, and `@Repo`.
 */
function createProviderDecorator(kind: ProviderKind, base?: InjectionToken): FlyflorClassDecorator {
  return (target: object, context?: ClassDecoratorContext) => {
    const constructor = target as unknown as Constructor;
    registerStandardMemberMetadata(constructor, context);
    decoratorRegistry.setProvider(constructor, base ?? constructor, kind);
  };
}

/**
 * Represents a class decorator compatible with both legacy and standard decorator runtimes.
 *
 * @param target - Decorated constructor function.
 * @param context - Optional standard class decorator context.
 * @returns Nothing.
 * @usage Public DI class decorators return this shape so Bun standard decorators and TypeScript can agree.
 */
type FlyflorClassDecorator = (target: object, context?: ClassDecoratorContext) => void;

/**
 * Describes the subset of standard decorator context that Flyflor needs.
 *
 * @property name - Decorated class member name.
 * @property kind - Decorated member kind such as `field` or `method`.
 * @property addInitializer - Standard decorator hook invoked during instance construction.
 * @usage Property and method decorators use this to support Bun's standard decorator runtime.
 */
interface StandardDecoratorContextLike {
  readonly name: string | symbol;
  readonly kind: string;
  readonly metadata?: Record<PropertyKey, unknown>;
  readonly addInitializer?: (initializer: (this: object) => void) => void;
}

/**
 * Checks whether a decorator argument is a standard decorator context.
 *
 * @param value - Unknown second decorator argument.
 * @returns True when the argument looks like a standard decorator context.
 * @usage Lets decorators support both legacy and standard decorator call shapes.
 */
function isStandardDecoratorContext(value: unknown): value is StandardDecoratorContextLike {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && "name" in value;
}

/**
 * Appends member metadata to a standard decorator context.
 *
 * @param context - Standard decorator context with shared class metadata.
 * @param key - Metadata bucket key.
 * @param value - Metadata value to append.
 * @returns Nothing.
 * @usage Method and property decorators use this so class decorators can register metadata before instances exist.
 */
function appendStandardMetadata(context: StandardDecoratorContextLike, key: string, value: unknown): void {
  if (!context.metadata) {
    return;
  }
  const existing = Array.isArray(context.metadata[key]) ? context.metadata[key] as unknown[] : [];
  context.metadata[key] = [...existing, value];
}

/**
 * Transfers standard member decorator metadata into Flyflor's registry.
 *
 * @param constructor - Provider class being decorated.
 * @param context - Class decorator context when available.
 * @returns Nothing.
 * @usage Provider-like decorators call this before registering the provider token.
 */
function registerStandardMemberMetadata(constructor: Constructor, context: ClassDecoratorContext | undefined): void {
  const metadata = context?.metadata as Record<PropertyKey, unknown> | undefined;
  if (!metadata) {
    return;
  }
  for (const injection of metadata["injections"] as Array<{ readonly propertyKey: string | symbol; readonly token: InjectionToken }> ?? []) {
    decoratorRegistry.addInjectionForConstructor(constructor, injection.propertyKey, injection.token);
  }
  for (const prompt of metadata["prompts"] as Array<{ readonly propertyKey: string | symbol; readonly relativePath: string }> ?? []) {
    decoratorRegistry.addPromptForConstructor(constructor, prompt.propertyKey, prompt.relativePath);
  }
  for (const subscription of metadata["subscriptions"] as Array<{ readonly methodKey: string | symbol; readonly signalName: string }> ?? []) {
    decoratorRegistry.addSubscriptionForConstructor(constructor, subscription.methodKey, subscription.signalName);
  }
}

import { decoratorRegistry } from "./registry";
import { ProviderKind, type Constructor, type InjectionToken, type ModuleOptions } from "./types";

/**
 * Declares a DI module boundary.
 *
 * @param options - Module imports, providers, and exports owned by this module.
 * @returns A class decorator that records module metadata.
 * @usage Use on classes that assemble providers; keep business logic out of module classes.
 */
export function Module(options: ModuleOptions): ClassDecorator {
  return (target) => {
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
export function Provide(base?: InjectionToken): ClassDecorator {
  return createProviderDecorator(ProviderKind.Provide, base);
}

/**
 * Registers a class as a business or orchestration service.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated service.
 * @returns A class decorator that records service provider metadata.
 * @usage Use on runtime capabilities such as agent orchestration, tool calls, and memory distillation.
 */
export function Service(base?: InjectionToken): ClassDecorator {
  return createProviderDecorator(ProviderKind.Service, base);
}

/**
 * Registers a class as an infrastructure component.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated component.
 * @returns A class decorator that records component provider metadata.
 * @usage Use on database, memory, context, model, and prompt-loading infrastructure classes.
 */
export function Component(base?: InjectionToken): ClassDecorator {
  return createProviderDecorator(ProviderKind.Component, base);
}

/**
 * Registers a class as a repository for data model and SQL operations.
 *
 * @param base - Optional abstract token or base class that should resolve to the decorated repo.
 * @returns A class decorator that records repo provider metadata.
 * @usage Use under `src/entities` for persistence-facing model classes.
 */
export function Repo(base?: InjectionToken): ClassDecorator {
  return createProviderDecorator(ProviderKind.Repo, base);
}

/**
 * Declares an explicit property injection.
 *
 * @param token - Class or symbol token to resolve for the property.
 * @returns A property decorator that records injection metadata.
 * @usage Use as `@Inject(ConfigService) public config!: ConfigService`; implicit type reflection is forbidden in v1.
 */
export function Inject(token: InjectionToken): PropertyDecorator {
  return (target, propertyKey) => {
    decoratorRegistry.addInjection(target, propertyKey, token);
  };
}

/**
 * Declares that a property should receive prompt text from a prompt file.
 *
 * @param relativePath - Relative prompt path, normally under `prompts` and ending with `.md`.
 * @returns A property decorator that records prompt injection metadata.
 * @usage Use as `@Prompt("./prompts/system.md") public systemPrompt!: string`.
 */
export function Prompt(relativePath: string): PropertyDecorator {
  return (target, propertyKey) => {
    decoratorRegistry.addPrompt(target, propertyKey, relativePath);
  };
}

/**
 * Declares that a method subscribes to a runtime signal.
 *
 * @param signalName - Signal name that the decorated method handles.
 * @returns A method decorator that records subscription metadata.
 * @usage Use on instance methods that will be wired to `SignalBus` after DI construction.
 */
export function Subscribe(signalName: string): MethodDecorator {
  return (target, propertyKey) => {
    decoratorRegistry.addSubscription(target, propertyKey, signalName);
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
function createProviderDecorator(kind: ProviderKind, base?: InjectionToken): ClassDecorator {
  return (target) => {
    const constructor = target as unknown as Constructor;
    decoratorRegistry.setProvider(constructor, base ?? constructor, kind);
  };
}

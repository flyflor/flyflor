import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { decoratorRegistry } from "./registry";
import type { Constructor, InjectionToken } from "./types";
import { SignalBus } from "../signal/signal-bus.service";

/**
 * Represents a bootstrapped DI container.
 *
 * @usage Use `createContainer(RootModule)` and then `resolve(ServiceClass)` in runtime entrypoints.
 */
export class Container {
  private readonly instances = new Map<InjectionToken, unknown>();
  private readonly bindings = new Map<InjectionToken, Constructor>();
  private readonly wiredSubscriptions = new WeakSet<object>();

  public constructor(private readonly projectRoot = process.cwd()) {}

  /**
   * Registers a concrete provider class.
   *
   * @param provider - Provider class decorated with a provider-like decorator.
   * @returns Nothing.
   * @usage Module bootstrap calls this for every declared provider.
   */
  public register(provider: Constructor): void {
    const metadata = decoratorRegistry.getProvider(provider);
    this.bindings.set(metadata?.token ?? provider, provider);
    this.bindings.set(provider, provider);
  }

  /**
   * Resolves a token to a singleton instance.
   *
   * @typeParam T - Expected instance type.
   * @param token - Class or symbol token to resolve.
   * @returns Resolved instance.
   * @usage Property injection and runtime entrypoints use this method.
   */
  public resolve<T>(token: InjectionToken<T>): T {
    const provider = this.bindings.get(token) ?? (typeof token === "function" ? token as Constructor<T> : undefined);
    if (!provider) {
      throw new Error(`No provider registered for token: ${String(token)}`);
    }
    if (this.instances.has(token)) {
      return this.instances.get(token) as T;
    }
    const instance = new provider();
    for (const injection of decoratorRegistry.getInjections(provider)) {
      Object.defineProperty(instance as object, injection.propertyKey, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.resolve(injection.token),
      });
    }
    for (const prompt of decoratorRegistry.getPrompts(provider)) {
      Object.defineProperty(instance as object, prompt.propertyKey, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.loadPrompt(prompt.relativePath),
      });
    }
    this.wireSubscriptions(provider, instance as object);
    this.instances.set(provider, instance);
    this.instances.set(token, instance);
    return instance as T;
  }

  /**
   * Wires `@Subscribe` methods to the container's SignalBus singleton.
   *
   * @param provider - Provider class whose metadata is being inspected.
   * @param instance - Constructed provider instance.
   * @returns Nothing.
   * @usage Called once per provider instance after property and prompt injection.
   */
  private wireSubscriptions(provider: Constructor, instance: object): void {
    if (this.wiredSubscriptions.has(instance) || provider === SignalBus) {
      return;
    }
    const subscriptions = decoratorRegistry.getSubscriptions(provider);
    if (subscriptions.length === 0 || !this.bindings.has(SignalBus)) {
      return;
    }
    const signalBus = this.resolve(SignalBus);
    for (const subscription of subscriptions) {
      const handler = (instance as Record<string | symbol, unknown>)[subscription.methodKey];
      if (typeof handler !== "function") {
        throw new Error(`@Subscribe target is not a method: ${String(subscription.methodKey)}`);
      }
      signalBus.subscribe(subscription.signalName, async (payload) => handler.call(instance, payload));
    }
    this.wiredSubscriptions.add(instance);
  }

  /**
   * Reads a runtime prompt for `@Prompt` property injection.
   *
   * @param relativePath - Project-relative prompt path declared by `@Prompt`.
   * @returns UTF-8 prompt text.
   * @usage Runtime prompt injection is synchronous and only reads `.md`, never `.zh.cn.md`.
   */
  private loadPrompt(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new Error(`Prompt path must be relative: ${relativePath}`);
    }
    if (!relativePath.endsWith(".md") || relativePath.endsWith(".zh.cn.md")) {
      throw new Error(`Runtime prompt path must reference an English .md file: ${relativePath}`);
    }
    return readFileSync(resolve(this.projectRoot, relativePath), "utf8");
  }
}

/**
 * Creates a container and registers providers declared by a module tree.
 *
 * @param rootModule - Root module class decorated by `@Module`.
 * @returns Bootstrapped `Container`.
 * @usage Runtime entrypoints use this once during startup.
 */
export function createContainer(rootModule: Constructor, projectRoot = process.cwd()): Container {
  const container = new Container(projectRoot);
  const visited = new Set<Constructor>();
  const visit = (moduleClass: Constructor): void => {
    if (visited.has(moduleClass)) {
      return;
    }
    visited.add(moduleClass);
    const moduleMetadata = decoratorRegistry.getModule(moduleClass);
    if (!moduleMetadata) {
      return;
    }
    for (const imported of moduleMetadata.imports) {
      visit(imported);
    }
    for (const provider of moduleMetadata.providers) {
      container.register(provider);
    }
  };
  visit(rootModule);
  return container;
}

# Architecture

This document describes the current implementation. Shared code-shape rules live in the `oop-code-redlines` skill; Flyflor-specific rules live in [AGENTS.md](../AGENTS.md).

## Runtime Flow

1. `src/bootstrap.ts` imports `reflect-metadata` before decorated classes load.
2. `Factory.create(AppModule)` delegates construction to the IOC container.
3. `AppModule` imports `PluginsModule` and injects `IPCService` plus `Synapse`.
4. `IPCService` starts the configured socket endpoint.
5. `FSocket` receives bytes, asks `PacketService` to decode packets, and routes valid packets.
6. `Synapse` owns the active agent pool and sends user packets to the active `Agent`.
7. `Agent` owns one turn: assemble messages through `Memory`, stream `Brain` output, then commit successful turns.
8. `Brain` maps assembled memory messages into model signal output.
9. `Intelligence` opens the configured provider stream through protocol adapters.

## IOC

`src/core/ioc/container.ts` is the only construction point for application classes.

- `useContainer()` returns the process-wide `Container` singleton.
- `getAsync()` is the normal construction path. It resolves module imports, singleton cache, constructor arguments, property injection, and `@Init()`.
- `get()` is the sync path. It may return already-initialized singletons, but it refuses fresh graphs that need `@Init()` or async injection factories.
- `create()` creates a fresh IOC-owned instance without singleton registration. It is used for path-bound objects such as loaded prompt/file objects.
- `registerObject()` can place an existing object into the singleton map under a class or symbol key.
- `defineMetadata()`, `getMetadata()`, and `getOwnMetadata()` wrap `Reflect` metadata helpers used by decorators.

Business code must not construct project classes directly.

### IOC Lifecycle Detail

`getAsync(Module, ...props)` follows this order:

1. Track the class in `classList`.
2. Return an existing singleton when `@Singleton()` metadata is present and cached.
3. Resolve `@Module({ imports })` recursively before constructing the requested class.
4. Build constructor arguments from explicit `props` first, then from initialized imported module instances by reflected constructor parameter type.
5. Construct the class inside the container.
6. Cache the instance early when it is a singleton, so dependency cycles can see the same object.
7. Inject registered instance providers such as `@Config()` before ordinary property dependencies.
8. Resolve `@Inject()` properties, including callback-produced constructor args for the injected class.
9. Run the one method marked by `@Init()`.
10. Remove a failed singleton from the cache before rethrowing.

Constructor injection is import-graph based: a constructor parameter is resolved only when an initialized imported module instance exactly matches the reflected parameter type. Property injection is metadata based: decorators record property keys and class types, then the container resolves each property through `getAsync()`.

`get(Module, ...props)` mirrors the same graph rules for synchronous construction, but throws if it would need to run `@Init()` or await an async injection callback.

## Decorator Index

General decorators live in `src/core/decorator.ts`:

- `@Module(metadata)`: marks an `FModule` boundary, makes it singleton, and records `imports`.
- `@Inject()`: injects a property by reflected `design:type`.
- `@Inject(ClassType)`: injects a property using an explicit class type.
- `@Inject(callback)`: calls the callback on the host instance and passes its result as constructor args to the injected class.
- `@Init()`: marks one lifecycle method to run after injection.
- `@Config(key?)`: injects `ConfigComponent` early and optionally exposes a nested config value.
- `@Singleton()`: marks a class as cached in the container singleton map.
- `@Provide()`: marks a class as an IOC provider without singleton caching.
- `@Service()`, `@Component()`, and `@Plugin()`: provider aliases for service/component/plugin classes.
- `@Repo()`: marks a repository as singleton.
- `@Controller()`: marks a controller-style class as singleton.
- `@Guard()` and `@SandBox()`: singleton markers for policy/sandbox classes.

Specialized decorators are exported through `src/core/index.ts`:

- `@Prompt()` from `src/core/prompt/decorator.ts`: binds a property to a loaded `FileService`, with global or agent-scoped path resolution.
- `@Logger()` from `src/core/logger/decorator.ts`: binds a property to a lazily created scoped logger.

## Base Class Index

Core base classes live in `src/core/ioc/abstracts.ts`:

- `FlyFlor`: root marker class for framework objects.
- `FModule`: module boundary.
- `FService`: behavior-owning service object.
- `FComponent`: stateful component or lifecycle owner.
- `FRepo`: repository/entity SQL owner.
- `FPlugin`: plugin boundary and RxJS `Subject` for plugin signals.
- `FGuard` and `FSandBox`: policy scopes.
- `FAgent`: autonomous agent subject used by `Agent`.
- `FCortex`: signal transform subject; `Brain` extends it and implements `transform(input)`.

Decorators live under `src/core`. The decorator expresses intent; the base class expresses object kind.

## Prompt And File Layer

`@Prompt()` injects a loaded `FileService`.

`FileService` owns one filesystem path, its loaded `data`, child file objects for directories, and persistence methods. Runtime prompt code reads canonical English `.md` files only; `.zh.cn.md` mirrors are human references.

`PromptService` loads an agent prompt package and can save complete markdown replacements for editable prompt sections.

## Agent Runtime

`Synapse` resolves the active configured profile and asks the container for an `Agent`.

`Agent.next(text)` asks `Memory.messages(text)` for either:

- an assembled provider message list; or
- a direct reply when memory analysis handled the turn.

For model turns, `Agent` streams `Brain.transform(input)` delta signals through its subject. It commits user/assistant context only after successful completion.

`Memory` owns working context and prompt-section assembly. `Brain` owns inference streaming. `Intelligence` owns provider communication and cancellation.

## Neural And IPC

`PacketService` owns the length-prefixed JSON packet protocol:

- 8-byte unsigned big-endian body length;
- UTF-8 JSON body;
- per-connection decode buffers;
- partial headers and bodies;
- multiple packets in one chunk;
- malformed and oversized packet reporting.

`FSocket` owns Bun socket callbacks and scopes each turn's streamed agent output to the requesting socket.

## Validation

`bun run check` currently runs TypeScript and `scripts/check.script.ts`. The checker enforces the rules currently implemented in that script; it is not a replacement for the shared `oop-code-redlines` review discipline.

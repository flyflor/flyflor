# Architecture

Flyflor uses code-first architecture. This document describes the current code; planned concepts should not be treated as implemented.

## Bootstrap

`src/main.bootstrap.ts` imports `reflect-metadata`, then calls `Factory.create(AppModule)`. `Factory` delegates construction to the shared IOC container.

## IOC

`src/core/ioc/ioc.container.ts` is the single application-class construction point. It:

- builds imports before dependents;
- stores every resolved class as a singleton;
- injects `@Config()` instance providers before ordinary `@Inject()` dependencies;
- runs one `@Init()` method after injection;
- removes a failed singleton if initialization throws.

Constructor arguments are explicit props first, then matching imported module instances by reflected parameter type.

## Decorators And Scopes

Decorators live in `src/core/core.decorator.ts`. Scope is expressed by both a decorator and a base class:

- `@Module()` with `FModule`;
- `@Service()` with `FService`;
- `@Component()` with `FComponent`;
- `@Repo()` with `FRepo`;
- `@Plugin()` with `FPlugin`;
- `@Guard()` / `@SandBox()` with guard base classes;
- `FAgent` for autonomous agent classes.

Business code should use class boundaries instead of exported process-style functions.

## Runtime Flow

`AppModule` imports `PluginModule` and injects `IPCService` plus `Synapse`. `IPCService` starts the socket. `Synapse` creates the configured active `Agent`, then routes socket packets into `Agent.pipe()`.

`Agent` currently logs packets. `IntelligenceService` contains an OpenAI-compatible streaming chat-completions client, but full conversation orchestration is not implemented yet.

## IPC

IPC uses newline-delimited JSON frames. `FSocket` buffers socket chunks and emits complete frames to `Synapse`. The public socket path is configured through `ConfigComponent.socket`.

## Validation

`scripts/check.script.ts` enforces key red lines:

- no project-class `new` outside the IOC container;
- no runtime references to `.zh.cn.md` prompt mirrors;
- prompt English/mirror pairs stay in sync;
- source files use dotted Angular/Nest-style names;
- exported function APIs stay in decorator/composition/bootstrap/tooling surfaces.

# Architecture

Flyflor is code-first. This document describes the current implementation only.

## Philosophy

Flyflor uses a semantic object model:

- `Agent` is the person. It has a profile, prompt, memory component, intelligence services, and a message context.
- `Prompt` is the agent's constitution and application protocol. It is loaded through `@Prompt()` as a file object.
- `FileService` is the physical object. It owns one filesystem path plus loaded state.
- `Neural` is signal transmission. `Synapse` owns active-agent routing.
- `IPC` is the external sensory boundary. Socket and packet classes translate outside bytes into kernel packets.
- `IOC` is creation and lifecycle. The container is the only application-class construction point.

The point of the metaphor is not decoration. It decides where code belongs. If a behavior cannot be named as an object with ownership, it probably belongs on an existing object.

## Bootstrap

`src/bootstrap.ts` imports `reflect-metadata` before decorated classes load, then calls `Factory.create(AppModule)`.

`Factory` delegates to `useContainer().getAsync(rootModule)`. The root module is `AppModule`, which imports `PluginModule` and injects `IPCService` plus `Synapse`.

## IOC

`src/core/ioc/container.ts` owns object construction and lifecycle:

- resolves module imports before dependents;
- caches singleton instances;
- resolves constructor props from explicit arguments or imported module instances;
- injects `@Config()` providers before ordinary `@Inject()` dependencies;
- injects reflected property dependencies;
- runs one `@Init()` method after injection;
- removes failed singletons when initialization throws;
- creates fresh path-bound objects through `create()` when singleton state would be wrong.

Business code must not construct project classes directly. If an object is part of the runtime, the container creates it.

## Core Scopes

Core base classes live in `src/core/ioc/abstracts.ts`:

- `FlyFlor`: root object.
- `FService`: stateless or behavior-owning service object.
- `FComponent`: stateful component or lifecycle owner.
- `FFile`: path-bound file object.
- `FModule`: module boundary.
- `FRepo`: repository/entity SQL owner.
- `FPlugin`: plugin boundary.
- `FGuard` and `FSandBox`: policy scopes.
- `FAgent`: autonomous agent object backed by an RxJS subject.
- `FCortex`: cortical transform — an RxJS subject that maps one assembled input into an output `Observable`. `Brain` is the only cortex today.

Decorators live in core module files:

- `src/core/decorator.ts`: general runtime decorators such as `@Module`, `@Inject`, `@Init`, `@Config`.
- `src/core/prompt/decorator.ts`: `@Prompt`.
- `src/core/logger/decorator.ts`: `@Logger`.

The decorator says intent; the base class says object kind. Use both when adding a new runtime scope.

## Prompt And File Layer

`@Prompt()` binds an agent property to a loaded `FileService`.

`FileService` loads one file or directory. For directories, canonical markdown files become object keys such as `SOUL.md -> data.SOUL`. Files with extra dotted stems are skipped by runtime, so human mirrors stay out of execution.

Prompt protocol blocks use `<flyflor:name>` tags with a JSONC payload. The renderable content goes to `data`; parsed controls go to `blocks`. Malformed protocol throws during load because prompt configuration should fail early.

## Agent Runtime

`Synapse` reads the active profile from `ConfigComponent`, resolves defaults from model config, then asks the container to create `Agent`.

`Agent` owns the turn. It injects a `Brain` (cortex) and a `Memory` (prefrontal working cache) and is itself the subject the neural layer subscribes to.

`Agent.next(text)` asks `Memory.messages(text)` for the assembled mental input, then either replies directly (when memory analyzed the turn) or subscribes `Brain.transform(input)` and streams its `delta` signals out chunk by chunk. On success it calls `Memory.commit(user, assistant)`; a failed or cancelled reflex commits nothing.

`Brain` is a pure `FCortex<AgentMemory[], AgentSignal>`: it maps the mental input into a cold `Observable` of model signals and never touches conversation context.

`Memory` assembles the system message and owns context. The ordinary provider-facing list is one `system` message first, then user/assistant history, then the current raw user message. Runtime Flyflor sections such as `SOUL`, `USER`, and `EXTENSION` are internal tags inside that system message; they are not model chat roles.

`AGENTS.md` is a locked write-control constitution. `Memory.analyze()` uses it to decide whether a user turn may update `SOUL.md`, `USER.md`, or `EXTENSION.md`, but it is not injected into ordinary conversation prompts.

## Neural And IPC

`IPCService` starts the public socket endpoint from configuration. On Windows the endpoint is converted to a named pipe internally.

`FSocket` owns Bun socket callbacks. It logs lifecycle events, writes the open event, decodes inbound bytes, reports malformed frames, and routes valid packets into `Synapse`.

`PacketService` owns the frame protocol:

- 8-byte unsigned big-endian body length;
- UTF-8 JSON body;
- per-connection decode buffers;
- partial headers and partial bodies;
- multiple frames in one chunk;
- oversized and malformed JSON frames.

## Logger

`src/core/logger` is compact by design:

- `service.ts`: `useLogger`, shared configuration, formatting, writing.
- `decorator.ts`: `@Logger`.
- `types.ts`: logger API and configuration types.
- `constants.ts`: formatting and default constants.

Formatting and writing are private implementation details inside `service.ts` unless they become large enough to justify a new object.

## Validation

`scripts/check.script.ts` enforces the red lines:

- application-class construction stays in the IOC container;
- runtime code does not reference human prompt mirrors;
- canonical prompt files and human mirrors stay paired under `prompts/`;
- source filenames follow approved role conventions;
- exported functions stay limited to decorator/container/logger/tooling surfaces.

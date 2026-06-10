# Boundaries

Shared boundary discipline comes from the `oop-code-redlines` skill. This document names the Flyflor directories and what each one owns today.

## Naming

Flyflor uses semantic directories plus role files.

```txt
src/core/prompt/
  index.ts
  service.ts
  decorator.ts
  constants.ts
  types.ts
```

`index.ts` is a barrel only. Do not add behavior there.

Prefer role files such as `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, `factory.ts`, `container.ts`, `abstracts.ts`, `socket.ts`, `module.ts`, `entity.ts`, `repository.ts`, and `*.test.ts`.

Legacy dotted names may remain until a focused migration. New code should not add dotted splits when the folder already names the object.

## Source Boundaries

- `src/core`: framework primitives, decorators, IOC, base classes, file/prompt/logger primitives.
- `src/config`: runtime configuration object and root path constants.
- `src/agent`: agent object, memory, brain, intelligence services, and mode placeholders.
- `src/neural`: signal routing, IPC socket handling, and packet framing.
- `src/entities`: repository/entity classes and SQL statement ownership.
- `src/plugins`: plugin module boundary and built-in tool plugin objects.
- `scripts`: local tooling; procedural code is allowed here.
- `prompts`: canonical runtime prompt sources and human mirrors.
- `sql`: schema files.

## Core Index

- Decorators:
  - `src/core/decorator.ts`: general IOC/runtime decorators.
  - `src/core/prompt/decorator.ts`: `@Prompt()`.
  - `src/core/logger/decorator.ts`: `@Logger()`.
- Base classes:
  - `src/core/ioc/abstracts.ts`: `FlyFlor`, `FService`, `FComponent`, `FFile`, `FModule`, `FRepo`, `FPlugin`, `FGuard`, `FSandBox`, `FAgent`, and `FCortex`.
- IOC:
  - `src/core/ioc/container.ts`: `Container`, `useContainer()`, construction, injection, lifecycle, and metadata helpers.
- Barrels:
  - `src/core/index.ts` exports the public core surface and imports `reflect-metadata`.
  - Directory-local `index.ts` files re-export local surfaces only.

## Object Ownership

- `Agent` owns a turn and streams output through its subject.
- `Memory` owns prompt assembly and working conversation context.
- `Brain` owns one inference transform.
- `Intelligence` owns provider communication and cancellation.
- `Synapse` owns active-agent routing.
- `FSocket` owns Bun socket callbacks.
- `PacketService` owns frame encoding and decoding.
- `FileService` owns path-bound file state and persistence.
- Repositories own SQL statements and entity shapes.

Do not move behavior away from the object that owns the relevant state or boundary.

## Imports

Use `@/*` imports across source domains. Use relative imports inside a directory boundary.

Injected class dependencies must be runtime imports so reflect metadata remains available.

## Scripts

`scripts` is a tooling boundary. It may use procedural helper functions. Production runtime code should use object methods except for the boundary APIs allowed by `oop-code-redlines`.

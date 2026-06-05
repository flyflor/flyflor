# Boundaries

## Naming

Class-bearing files use dotted role names:

- `*.module.ts`
- `*.service.ts`
- `*.component.ts`
- `*.repository.ts`
- `*.entity.ts`
- `*.decorator.ts`
- `*.constants.ts`
- `*.types.ts`
- `*.bootstrap.ts`
- `*.script.ts`

`index.ts` files are barrels only.

## Core

`src/core` owns the framework layer: IOC, decorators, base classes, logging, constants, and bootstrap factory. Business domains import framework primitives through `@/core`.

## Config

`src/config` owns `ConfigComponent` and root path constants. Config is loaded from `./.config/config.jsonc`; secrets stay in environment variables.

## Agent

`src/agent` owns the agent class and supporting components/services. Current memory and crystallized-intelligence classes are placeholders; documents should not present them as complete systems.

## Neural And IPC

`src/neural` owns the runtime transformer and IPC transport. External clients talk through the socket boundary; business classes should not open their own external transport.

## Entities

`src/entities` owns entity classes and repositories. Repositories currently return parameterized SQL statements and do not pretend persistence exists.

## Plugins

`src/plugins` is the plugin module boundary. Concrete skill/MCP plugin loading is not implemented in the current code.

## Scripts

Scripts are tooling surfaces and may use procedural code when appropriate. Production source should keep behavior behind classes, decorators, or composition APIs.

# Boundaries

Flyflor uses folders as nouns and files as roles. A directory should name the thing; files inside it should name the responsibility.

## Naming

Preferred module shape:

```txt
src/core/prompt/
  index.ts
  decorator.ts
  constants.ts
  types.ts
```

Allowed compact role files:

- `index.ts`
- `service.ts`
- `types.ts`
- `constants.ts`
- `decorator.ts`
- `factory.ts`
- `container.ts`
- `abstracts.ts`
- `socket.ts`
- `*.test.ts`

Legacy dotted files may remain where they already exist. Do not introduce new dotted splits just to imitate Angular/Nest when the folder already provides the noun.

`index.ts` is always a barrel. It must not own logic.

## Object Rule

Object-oriented code means behavior belongs to a visible thing:

- Agent behavior belongs to `Agent`.
- Prompt loading belongs to `@Prompt()` and `FileService`.
- File persistence belongs to `FileService`.
- Packet framing belongs to `PacketService`.
- Socket callbacks belong to `FSocket`.
- Model completion belongs to `Intelligence`.
- SQL statement ownership belongs to repositories.

Avoid new manager/parser/compiler/diagnostic files unless a real object boundary has appeared.

## Core

`src/core` owns framework primitives only:

- `decorator.ts`: common decorators.
- `factory.ts`: bootstrap factory.
- `ioc/`: base classes, container, metadata types.
- `file/`: path-bound file object.
- `prompt/`: prompt decorator and protocol types/constants.
- `logger/`: logger decorator/service/types/constants.

Business domains should import primitives from `@/core`, not reach into unrelated core internals unless they are extending the core itself.

## IOC

The container is the only place where application classes are constructed. `getAsync()` is for singleton graph objects. `create()` is for fresh IOC-owned objects such as path-bound files.

Do not use `new` for project classes in business code. Built-ins such as `Error`, `Map`, `Set`, `Date`, `TextDecoder`, `Response`, and `RegExp` are allowed.

## Decorators

Decorators are core API, so exported decorator functions are allowed.

General decorators live in `src/core/decorator.ts`. Specialized decorators live with their semantic module:

- `@Prompt` in `src/core/prompt/decorator.ts`
- `@Logger` in `src/core/logger/decorator.ts`

Do not hide a new runtime scope behind config strings. Add a base class and a decorator when the scope is real.

## Prompt And Files

Runtime code reads canonical `.md` prompt files only. Human mirror files are maintained as documentation aids and are rejected by runtime rules.

`FileService.data` is the renderable content. `FileService.blocks` is the prompt application protocol index. Do not add extra public state unless an agent actually consumes it.

## Agent

`src/agent` owns the person-like runtime object:

- prompt context assembly;
- user/assistant turn history;
- injected brain and memory objects;
- profile-specific runtime state.

Do not put provider wire logic in `Agent`; that belongs in `Intelligence`. Do not put packet/socket concerns in `Agent`; those belong in `neural`.

## Neural

`src/neural` owns signal flow:

- `Synapse` routes decoded packets to the active agent.
- `ipc/` owns the transport listener and socket handler.
- `packet/` owns byte framing.

External clients talk through IPC. Business objects should not open ad hoc sockets.

## Config

`src/config` owns the configuration object and root path constant. Config is loaded from `./.config/config.jsonc`; secrets must be read from environment variables.

## Entities

`src/entities` owns SQL statement objects and entity shapes. Current repositories return parameterized SQL statements. Do not document persistence behavior that does not exist.

## Scripts

`scripts` is a tooling boundary. Procedural code is allowed there, including exported helper functions when useful. Production source should prefer object methods.

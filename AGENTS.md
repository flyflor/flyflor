# AGENTS.md - Flyflor Engineering Rules

This file is the project authority for coding rules. Code is the source of truth: docs must describe implemented code, not imagined architecture.

## Positioning

Flyflor is a Bun + TypeScript agent kernel. The runtime is object-first: agents, files, modules, services, repositories, sockets, packets, and prompts are visible objects with names, ownership, lifecycle, and boundaries.

The design language is intentionally semantic:

- `Agent` is a person-like runtime object. It owns its profile, prompt, conversation context, and subscriptions.
- `Prompt` is the agent's constitution and application protocol. `@Prompt()` injects a loaded file object; prompt blocks such as `<flyflor:xxx>` are application controls, not model chat roles.
- `FileService` is a tangible file object. It has a bound path, loaded `data`, parsed `blocks`, and explicit persistence methods.
- `Neural` is the signal layer. `Synapse` receives packets and routes them into the active agent.
- `IPC` is the external sense boundary. Socket and packet classes own wire transport, not business behavior.
- `IOC` is the construction and lifecycle boundary. Application objects are made by the container, not by arbitrary `new`.

## Red Lines

1. Code first. Update docs after code changes, and describe only implemented behavior unless a section is explicitly marked as planned.
2. Use object boundaries. Business behavior belongs in classes extending the correct core base class: `FModule`, `FService`, `FComponent`, `FFile`, `FRepo`, `FPlugin`, `FGuard`, `FSandBox`, or `FAgent`.
3. Decorators and base classes live under `src/core`. New runtime scopes must be expressed through decorators plus inheritance, not loose registries or string-only flags.
4. Only the IOC container may construct application classes. Do not call `new` for project classes outside `src/core/ioc/container.ts`; use `useContainer().getAsync()` or `useContainer().create()` where a fresh path-bound object is required.
5. Preserve reflect metadata. `reflect-metadata` must load before decorated classes, and injected class dependencies must be runtime imports, not type-only imports.
6. Directory-local role files are the main naming convention. Approved role names are `index.ts`, `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, `factory.ts`, `container.ts`, `abstracts.ts`, and `socket.ts`. Legacy dotted names may remain where already present, but do not introduce new unnecessary dotted splits.
7. `index.ts` is a barrel only. It re-exports local module surfaces and must not own behavior.
8. Keep modules compact. Do not split one small behavior into `parser/compiler/diagnostic/transformer` files unless the code is large enough to justify the boundary.
9. Exported function APIs are reserved for decorators, IOC/container helpers, logger core helpers, bootstrap/tooling scripts, and explicit composition-style APIs. Domain behavior should be methods on objects.
10. Use `@/*` imports for cross-domain source imports. Relative imports are preferred inside the same directory boundary.
11. Every repository documentation `.md` file must have a `.zh.cn.md` human mirror. This includes root-level `*.md`, `docs/**/*.md`, and `prompts/**/*.md`.
12. Runtime prompt sources are canonical English `.md` files. `.zh.cn.md` mirrors are human references and must never be read by runtime code.
13. Keep config in `./.config/config.jsonc`; keep secrets in environment variables.
14. IPC frames are 8-byte big-endian length-prefixed JSON. Socket code must tolerate chunking, frame coalescing, malformed frames, and split UTF-8 bytes.
15. `bun run check` is the minimum health gate before considering a change healthy; run relevant `bun test` suites for behavior changes.

## Naming And Folders

Directory-local role files are the preferred shape:

```txt
src/core/logger/
  index.ts
  service.ts
  decorator.ts
  types.ts
  constants.ts
  service.test.ts
```

Use this shape when a folder is already the semantic noun. The folder says "logger"; the file says "service".

Use dotted legacy names only when the directory is not a semantic noun or when touching existing legacy code would broaden the task. Do not bulk rename unrelated files.

## Directory Roles

- `src/core`: framework primitives: IOC, base classes, decorators, file objects, prompt protocol, logger, and bootstrap factory.
- `src/core/ioc`: container, reflect metadata helpers, core abstract base classes, IOC types.
- `src/core/file`: path-bound file object and persistence surface.
- `src/core/prompt`: `@Prompt()` and Flyflor prompt block protocol constants/types.
- `src/core/logger`: `@Logger()`, logger configuration, formatting, writing, constants, and logger types.
- `src/config`: runtime configuration object and root path constants.
- `src/agent`: agent object, prompt-context assembly, memory placeholder, brain services, mode placeholders.
- `src/neural`: signal routing and IPC transport boundary.
- `src/neural/packet`: IPC frame encoding/decoding.
- `src/neural/ipc`: Bun socket listener and socket handler.
- `src/entities`: repository/entity classes and SQL statement owners.
- `src/plugins`: plugin module boundary.
- `scripts`: local tooling; procedural code is allowed here.
- `prompts`: canonical runtime prompt sources and human mirrors.
- `sql`: schema files.

## Documentation Mirrors

Every canonical `.md` document has a `.zh.cn.md` sibling with the same stem. The English/canonical document is the runtime and tooling source; the Chinese mirror is for human reading and must not be imported or opened by runtime code.

## Worktree Policy

The worktree may be dirty. Do not revert user changes. Ignore unrelated changes unless they block the task. Use branches for parallel lines of work; do not create persistent linked worktrees unless explicitly requested.

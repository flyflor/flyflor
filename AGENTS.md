# AGENTS.md - Flyflor Engineering Rules

This file is the project authority for coding rules. Code is the source of truth: documents and red lines must follow the runnable code, and design claims must not describe features that are not implemented.

## Positioning

Flyflor is a Bun + TypeScript agent kernel. The current codebase centers on a NestJS/Angular-inspired object model: modules, services, components, repositories, decorators, and a reflect-metadata IOC container.

## Red Lines

1. Keep the code first. Update docs after code changes, and describe only the implemented behavior unless a section is explicitly marked as planned.
2. Use Angular/NestJS-style file names for source code: `name.module.ts`, `name.service.ts`, `name.component.ts`, `name.repository.ts`, `name.entity.ts`, `name.decorator.ts`, `name.constants.ts`, `name.types.ts`, `name.bootstrap.ts`, and `name.script.ts`. `index.ts` is only a barrel.
3. Use OOP boundaries for business code. Domain behavior belongs in classes extending the appropriate core base class. Exported function APIs are reserved for decorators, composition APIs, bootstrap entrypoints, and tooling scripts.
4. Keep composition explicit. Domain directories may expose `*.composition.ts` for `useXxx()` style helpers, but class ownership and lifecycle still live in modules/services/components.
5. Keep decorators and base classes centralized under `src/core`. New scopes must be expressed through inheritance and decorators, not loose registries.
6. Only the IOC container may construct application classes. Do not call `new` for project classes outside `src/core/ioc/ioc.container.ts`.
7. Preserve reflect metadata. `reflect-metadata` must load before decorated classes, and injected class dependencies must be runtime imports, not type-only imports.
8. Use `@/*` imports for cross-domain source imports. Relative imports are fine inside the same directory boundary.
9. Runtime prompt sources are English `.md` files. `.zh.cn.md` mirrors are for humans and must never be read by runtime code.
10. Keep config in `./.config/config.jsonc` and secrets in environment variables.
11. IPC frames are 8-byte big-endian length-prefixed JSON. Socket code must tolerate chunking, frame coalescing, and split UTF-8 bytes.
12. `bun run check` is the minimum validation gate before considering a change healthy.

## Directory Roles

- `src/core`: IOC, decorators, base classes, logger, bootstrap factory, shared constants.
- `src/config`: runtime configuration component and path constants.
- `src/agent`: agent class, memory component, brain services, mode placeholders.
- `src/neural`: neural transformer and IPC transport boundary.
- `src/entities`: repository/entity classes and SQL statement owners.
- `src/plugins`: plugin module boundary.
- `scripts`: local verification and IPC bridge scripts.
- `prompts`: prompt sources and human-readable mirrors.
- `sql`: schema files.

## Worktree Policy

Use branches for parallel lines of work. Do not keep persistent linked worktrees for this repository unless explicitly requested for a short-lived task, and prune stale worktree metadata after use.

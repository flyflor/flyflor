# Flyflor

Flyflor is a Bun + TypeScript agent kernel. It uses decorators, base classes, and a reflect-metadata IOC container to keep construction, lifecycle, prompt loading, IPC, and model calls explicit.

## Engineering Rules

Flyflor follows the shared `oop-code-redlines` skill for general code shape:

- OOP owns business behavior.
- Composition API is limited to explicit boundaries.
- Semantic directories plus role files are the naming default.
- Method bodies have a 300-line soft limit and a 500-line hard limit.
- Do not extract helpers unless they create a real named action, reuse, side-effect boundary, or complexity reduction.

Repository-specific rules are in [AGENTS.md](AGENTS.md).

## Development

```bash
bun install
bun run check
bun test
bun run dev
bun run build:binary
```

`bun run check` runs TypeScript plus the current project red-line scanner. It is the minimum health gate.

## Current Runtime Flow

1. `src/bootstrap.ts` imports `reflect-metadata`, then calls `Factory.create(AppModule)`.
2. `Container` builds module imports, injects decorated properties, runs `@Init()`, and stores singleton instances.
3. `ConfigComponent` loads `./.config/config.jsonc`; secrets stay in environment variables.
4. `IPCService` starts the Bun Unix socket or Windows named pipe.
5. `FSocket` receives bytes and delegates packet decoding to `PacketService`.
6. `PacketService` encodes and decodes 8-byte big-endian length-prefixed JSON packets.
7. `Synapse` creates the configured active `Agent` and routes decoded packets into it.
8. `Brain` coordinates one user input, asks `Context` to ingest the turn, and routes reply/research/soul work.
9. `Memory` assembles pure agent memory input from protocol-package sections plus turn summaries.
10. `Investigation` runs a local action loop for research turns only.
11. `Synapse` broadcasts reply, action, ask/confirm, and pause/resume control signals.
12. `Intelligence` opens the configured provider stream through protocol adapters.

## Source Layout

```txt
src/core/          IOC, decorators, base classes, file/prompt/logger primitives
src/config/        runtime configuration object
src/agent/         agent, memory, brain, modes
src/neural/        synapse, IPC socket, packet encoding
src/entities/      repository/entity classes and SQL owners
src/plugins/       plugin module boundary
scripts/           local tooling
prompts/           canonical prompt sources and human mirrors
sql/               schema files
```

Folders are semantic nouns. Files inside them use role names such as `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, `repository.ts`, and `index.ts`.

## Prompt Runtime

Runtime prompt files are canonical English `.md` files. Human mirror files such as `.zh.cn.md` exist for readers and are not opened by runtime code.

Agent prompt directories are loaded through `@Prompt()` as `FileService` objects. The agent consumes the loaded file data; it does not read prompt files directly.

## More Docs

- [Architecture](docs/architecture.md): runtime flow, decorator index, base class index, and IOC details.
- [Boundaries](docs/boundaries.md): directory ownership, core source locations, object ownership, and import rules.

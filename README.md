# Flyflor

Flyflor is a Bun + TypeScript agent kernel with a small NestJS/Angular-inspired runtime: decorators, modules, services, components, repositories, and a reflect-metadata IOC container.

## Development

```bash
bun install
bun run check
bun run dev
bun run build:binary
```

## Current Implementation

- `Factory.create(AppModule)` bootstraps the root module.
- `Container` owns singleton construction, property injection, constructor props, and `@Init` lifecycle calls.
- `ConfigComponent` loads `./.config/config.jsonc`.
- `Synapse` Synapse owns the active agent pool and receives IPC packets.
- `IPCService` exposes a Bun Unix socket / Windows named-pipe boundary.
- `FSocket` speaks newline-delimited JSON frames.
- `Agent` is currently a thin runtime shell wired to brain and memory components.

See [Architecture](docs/architecture.md) and [Boundaries](docs/boundaries.md).

# Flyflor

Flyflor is a Bun + TypeScript agent kernel built around visible runtime objects. It uses decorators, base classes, and a reflect-metadata IOC container to keep construction, lifecycle, prompt loading, IPC, and model calls explicit.

## Object Model

Flyflor treats architecture names as engineering constraints:

- An `Agent` is a person-like object. It owns profile configuration, prompt constitution, chat context, and subscriptions.
- A `Prompt` is the agent's constitution plus application protocol. `@Prompt()` injects a loaded `FileService`, so agent code reads `prompt.data` and `prompt.blocks` instead of touching the filesystem.
- A `FileService` is a tangible file object. It binds to one path, loads markdown data, extracts `<flyflor:xxx>` protocol blocks, and exposes explicit create/update/upsert/delete methods.
- `Neural` is the signal layer. `Synapse` routes decoded packets into the active agent.
- `IPC` is the external sense boundary. Packet and socket objects own the wire protocol.
- `IOC` is the construction boundary. Application objects are created by `Container`, not by scattered `new` calls.

## Development

```bash
bun install
bun run check
bun test
bun run dev
bun run build:binary
```

`bun run check` runs TypeScript plus the project red-line checker. It is the minimum health gate.

## Current Runtime Flow

1. `src/bootstrap.ts` imports `reflect-metadata`, then calls `Factory.create(AppModule)`.
2. `Container` builds module imports, injects decorated properties, runs `@Init()`, and stores singleton instances.
3. `ConfigComponent` loads `./.config/config.jsonc`; secrets stay in environment variables.
4. `IPCService` starts the Bun Unix socket or Windows named pipe.
5. `FSocket` receives bytes and delegates frame parsing to `PacketService`.
6. `PacketService` encodes and decodes 8-byte big-endian length-prefixed JSON frames.
7. `Synapse` creates the configured active `Agent` and routes decoded packets into it.
8. `Agent` assembles one system message from prompt sections and appends user/assistant context turns.
9. `Intelligence` is the OpenAI-compatible streaming chat-completions client.

## Source Layout

```txt
src/core/          IOC, base classes, decorators, file/prompt/logger primitives
src/config/        runtime configuration object
src/agent/         agent, memory placeholder, brain services, modes
src/neural/        synapse, IPC socket, packet framing
src/entities/      SQL statement owners and entity shapes
src/plugins/       plugin module boundary
scripts/           local tooling
prompts/           canonical prompt sources and human mirrors
sql/               schema files
```

Folders are semantic nouns. Files inside them usually use compact role names such as `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, and `index.ts`.

## Prompt Runtime

Runtime prompt files are canonical English `.md` files. Human mirror files such as `.zh.cn.md` exist for readers and are not opened by runtime code.

Agent prompt directories are loaded by `@Prompt()`:

```ts
@Prompt('agent', function wrapper(this: Agent) {
    return this.agentConfig.name;
})
public prompt!: FileService<AgentPrompt>;
```

Markdown protocol blocks are application-level controls:

```md
<flyflor:ask_policy>
{
    version: 1,
    enabled: true,
    maxQuestions: 3,
}
</flyflor:ask_policy>
```

The renderable markdown goes to `prompt.data`; parsed protocol blocks go to `prompt.blocks`.

## More Docs

- [Architecture](docs/architecture.md)
- [Boundaries](docs/boundaries.md)

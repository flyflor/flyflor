# Flyflor

Flyflor is a Bun + TypeScript agent runtime designed to compile into a single binary. It combines LLM fluid intelligence with reflection-based crystal intelligence, spatial memory, blackboard collaboration, multi-channel gateway, CLI/TUI, MCP, skills, sandbox policy, and session memory.

飞花是一个 Bun + TypeScript 智能体运行时，目标是单文件二进制交付。核心设计是：LLM 负责流体智力，反思沉淀晶体智力，空间记忆负责联想召回，黑板负责复杂任务协作。

## Start Here

```bash
bun install
bun run install:templates
bun run chat
```

Useful commands:

```bash
bun run init
bun run status
bun run doctor
bun run tui
bun run app.ts gateway
```

Quality checks:

```bash
bun run format:check
bun run check
bun test
bun run build:binary
```

## Docker Dev

Docker dev runs the compiled Linux binary. Compose does not install dependencies or build inside the container.

```bash
bun run docker:dev
curl http://127.0.0.1:18790/health
docker exec -it flyflor-dev flyflor
```

Mounted paths:

| Host path                  | Container path               | Purpose                 |
| -------------------------- | ---------------------------- | ----------------------- |
| `.`                        | `/workspace`                 | repo workspace          |
| `./docker/config`          | `/root/.flyflor`             | dev config and prompts  |
| `./docker/storage/flyflor` | `/root/.local/share/flyflor` | session and memory data |
| `./dist/flyflor-linux`     | copied to `/usr/local/bin`   | compiled binary         |

Qdrant and SurrealDB are internal compose services only. They are not published to host ports.

## Architecture

Current source layout:

| Path           | Role                                                        |
| -------------- | ----------------------------------------------------------- |
| `app.ts`       | thin binary entry                                           |
| `src/app.ts`   | FlyFlor composition root                                    |
| `src/command`  | CLI, TUI, command registry, terminal rendering              |
| `src/agent`    | runtime, gateway, blackboard, session, sandbox, worker, MCP |
| `src/agent/di` | `@Module`, `@Provide`, `@Inject`, registry, container       |
| `src/llm`      | model providers, OpenAI/Anthropic-compatible protocol layer |
| `src/crystal`  | reflection candidates, crystal skills, SurrealDB store      |
| `src/neural`   | hippocampus-like memory, recall, SQLite/Qdrant indexes      |
| `src/protocol` | contracts, enums, events, process envelopes                 |
| `templates`    | prompt and memory Markdown templates                        |

Decorator rules:

- Keep only `@Module`, `@Provide`, `@Inject`, `@Service`, `@Component`, `@Worker`, `@Channel`, `@Plugin`.
- Boundary modules use object-oriented semantics: `class RuntimeModule extends Runtime`, `class GatewayModule extends Gateway`, `class SessionModule extends Session`, etc.
- Role-bearing implementation files use dot suffixes: `*.module.ts`, `*.service.ts`, `*.worker.ts`, `*.manager.ts`, `*.adapter.ts`, `*.store.ts`.
- Database and storage implementations use `@Component`.
- Service-like code stays inside its owning module and may use `@Service`.
- No reflection scanning, no dynamic directory loading, no hidden fallback prompt logic.

## Memory

Flyflor uses layered memory:

| Layer                 | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Markdown              | durable human-readable source of truth                           |
| SQLite                | session timeline, history, candidates, FTS, audit records        |
| Internal vector index | best-effort semantic recall acceleration                         |
| SurrealDB Crystal     | candidate, atom, skill, symbolic coordinates, relationship graph |

Long-term memory writes require a structured `memory_action` emitted in the same model turn. Ordinary chat text, keywords, regexes, and affect scores do not promote memory by themselves.

Prompt templates live in `templates/prompts` with `.zh.cn.md` review copies. Runtime reads installed Markdown from `~/.flyflor/prompts`; Docker dev reads `./docker/config/prompts`.

## Blackboard

Runtime asks `blackboard.route.md` for a structured route:

- `direct`: answer directly.
- `direct-with-watch`: answer directly while watching for escalation signals.
- `blackboard`: run worker discussion.

Blackboard can converge on the first decisive round. Non-decisive discussions continue toward a 5-round hard cap. If blocked, it returns numbered issues to the user instead of looping.

## Documentation

| Document                                                             | Purpose               |
| -------------------------------------------------------------------- | --------------------- |
| [TODO.md](TODO.md)                                                   | cleaned P0-P5 roadmap |
| [DESIGN.md](DESIGN.md)                                               | long-form philosophy  |
| [docs/boundaries.md](docs/boundaries.md)                             | engineering rules     |
| [docs/di.protocol.architecture.md](docs/di.protocol.architecture.md) | DI/protocol design    |
| [docs/memory.architecture.md](docs/memory.architecture.md)           | memory architecture   |
| [docs/crystal.memory.md](docs/crystal.memory.md)                     | crystal memory flow   |
| [docs/blackboard.worker.design.md](docs/blackboard.worker.design.md) | blackboard design     |
| [docs/prompt.templates.md](docs/prompt.templates.md)                 | Markdown template map |

Development rules are also mirrored in [AGENTS.md](AGENTS.md).

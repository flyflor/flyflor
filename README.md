# Flyflor

Flyflor is a Bun + TypeScript agent runtime designed to compile into a single binary. It combines LLM fluid intelligence with reflection-based crystal intelligence, spatial memory, blackboard collaboration, multi-channel gateway, CLI/TUI, MCP, skills, sandbox policy, and session memory.

飞花是一个 Bun + TypeScript 智能体运行时，目标是单文件二进制交付。核心设计是：LLM 负责流体智力，反思沉淀晶体智力，空间记忆负责联想召回，黑板负责复杂任务协作。

## Start Here

### Install (curl-pipe, no source clone)

```bash
curl -fsSL https://flyflor.dev/install.sh | sh
# Pin a version:
curl -fsSL https://flyflor.dev/install.sh | sh -s -- --version v0.4.0
# Custom prefix:
curl -fsSL https://flyflor.dev/install.sh | sh -s -- --prefix /usr/local/flyflor
# Update / Uninstall:
curl -fsSL https://flyflor.dev/install.sh | sh -s -- --update
curl -fsSL https://flyflor.dev/install.sh | sh -s -- --uninstall
```

The script downloads the matching `flyflor-{os}-{arch}` binary and `flyflor-templates.tar.gz` from GitHub releases, installs them under `~/.flyflor` by default, and prints the `PATH` line if the bin dir is not yet on it. `--uninstall` keeps your config and data under the prefix.

### From source

```bash
bun install
bun run install:templates
bun run chat
```

Useful commands:

```bash
bun run setup
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

Redis and SurrealDB are internal compose services only. They are not published to host ports.

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
| `src/crystal`  | crystal intelligence: episode, memory_node, skill, consolidation, dream mode |
| `src/neural`   | hippocampus-like working memory: Redis episodes, recall, recent-exchanges    |
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

Flyflor uses a hippocampus-inspired layered memory:

| Layer                 | Backend     | Purpose                                                                |
| --------------------- | ----------- | ---------------------------------------------------------------------- |
| Constitutional        | Markdown    | identity, user preferences, project facts (hand-edited, slow-changing) |
| Working memory        | Redis       | episode buffer with TTL-based forgetting curve, recent-exchange ring   |
| Long-term graph       | SurrealDB   | episode → memory_node → skill, with RELATE edges and MTREE ANN         |
| Audit log             | SQLite      | replay/debug + blackboard turn state                                   |

Episodes are captured asynchronously after every turn. Consolidation (LLM-assisted reinforce/consolidate/discard) runs as a background worker triggered by Redis ZSET pre-expiry sweep. Skill upgrades go through two quality gates: episode source-kind weight + cluster evidence score.

Markdown writes still require a structured `memory_action`. Ordinary chat does not promote constitutional memory by itself, but every turn produces working-memory episodes that may consolidate into long-term knowledge over time.

Prompt templates live in `templates/prompts` with `.zh.cn.md` review copies. Runtime reads installed Markdown from `~/.flyflor/prompts`; Docker dev reads `./docker/config/prompts`.

## Blackboard

Runtime asks `blackboard.route.md` for a structured route:

- `direct`: answer directly.
- `direct-with-watch`: answer directly while watching for escalation signals.
- `blackboard`: run worker discussion.

Blackboard can converge on the first decisive round. Non-decisive discussions continue toward a 5-round hard cap. If blocked, it returns numbered issues to the user instead of looping.

## Documentation

| Document                                                             | Purpose                              |
| -------------------------------------------------------------------- | ------------------------------------ |
| [DESIGN.md](DESIGN.md)                                               | architecture single source of truth  |
| [TODO.md](TODO.md)                                                   | active backlog                       |
| [AGENTS.md](AGENTS.md)                                               | agent / contributor hard rules       |
| [docs/boundaries.md](docs/boundaries.md)                             | engineering boundaries               |
| [docs/di.protocol.architecture.md](docs/di.protocol.architecture.md) | DI / protocol layering               |
| [docs/blackboard.worker.design.md](docs/blackboard.worker.design.md) | blackboard worker protocol           |
| [docs/prompt.templates.md](docs/prompt.templates.md)                 | prompt template registry             |
| [docs/cli.command.status.md](docs/cli.command.status.md)             | CLI command inventory                |

Development rules are also mirrored in [AGENTS.md](AGENTS.md).

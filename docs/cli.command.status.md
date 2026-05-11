# CLI Command Status

本文追踪 Flyflor CLI 命令面实现进度。清单必须按 `src/command/cli/commands.ts` 的 `GLOBAL_OPTIONS` 和 `COMMAND_SPECS` 逐项维护。每完成一个命令、子命令、别名或选项，只更新对应那一行。

状态约定：

- Done：命令行为可用，已接入真实 runtime/config/store/gateway 状态。
- Partial：主命令可用，但下面仍有选项或副作用未完成。
- Blocked：命令面已注册，但需要先补协议或底层能力，不能只在 CLI 层完成。
- Todo：命令已注册但仍是占位、未接线或未验收。

## Current Cursor

- Next: continue filling CLI commands backed by existing stores.
- Last done: Streamable HTTP MCP runtime client plus project-local skill usage summary.

## Global Options

- [ ] `-V, --version` - Todo. Global version flag is registered but root dispatch has not been wired.
- [x] `-z, --oneshot <prompt>` - Done. Reuses `chat --query` one-shot runtime path.
- [ ] `-m, --model <model>` - Todo. Global model override is registered but not wired.
- [ ] `--provider <provider>` - Todo. Global provider override is registered but not wired.
- [ ] `-t, --toolsets <toolsets>` - Todo. Global toolset override is registered but not wired.
- [ ] `--accept-hooks` - Todo. Global root hook approval override is registered but root dispatch has not been wired.
- [ ] `-s, --skills <skills...>` - Todo. Global skill preload is registered but not wired.
- [ ] `--ignore-user-config` - Todo. Registered but config loading bypass is not wired.
- [ ] `--tui` - Todo. Registered but root flag dispatch to TUI is not wired.

## Chat

- [~] `chat` - Partial. Interactive stdin loop exists.
- [x] `chat --query <query>` / `chat -q <query>` - Done. Sends one stdio message through Runtime and exits.
- [!] `chat --image <path>` - Blocked. `GatewayMessage` / `ModelMessage` currently have no media attachment contract.
- [x] `chat --model <model>` / `chat -m <model>` - Done. Temporarily overrides model id for this invocation without writing config.
- [x] `chat --provider <provider>` - Done. Temporarily selects provider profile for this invocation without writing config.
- [!] `chat --toolsets <toolsets>` / `chat -t <toolsets>` - Blocked. No toolset registry or per-run tool policy contract exists yet.
- [x] `chat --skills <skills...>` / `chat -s <skills...>` - Done. Explicit skill names are passed through `RuntimeContext` and preloaded by exact skill name.
- [x] `chat --verbose` / `chat -v` - Done. Uses `ConsoleEventSink` for runtime event diagnostics in chat mode.
- [x] `chat --quiet` / `chat -Q` - Done. One-shot chat buffers deltas and prints only final response text; it also suppresses verbose event diagnostics.
- [x] `chat --accept-hooks` - Done. Temporarily sets `sandbox.shellHookApproval=allow` for this invocation.
- [ ] `chat --max-turns <n>` - Todo. Registered but runtime turn cap is not wired.
- [ ] `chat --tui` - Todo. Registered but chat flag dispatch to TUI is not wired.
- [x] root interactive chat - Done. Default command enters stdin chat loop.

## TUI

- [x] `tui` - Done. Starts terminal UI.

## Gateway

- [x] `gateway run` - Done. Runs gateway in foreground.
- [ ] `gateway run --verbose` / `gateway run -v` - Todo. Registered but log verbosity is not wired.
- [ ] `gateway run --quiet` / `gateway run -q` - Todo. Registered but log suppression is not wired.
- [x] `gateway run --accept-hooks` - Done. Temporarily sets `sandbox.shellHookApproval=allow` for this invocation.
- [ ] `gateway start` - Todo. Background service startup is not implemented.
- [ ] `gateway stop` - Todo. Background service stop is not implemented.
- [ ] `gateway restart` - Todo. Background service restart is not implemented.
- [x] `gateway status` - Done. Shows channel status through Gateway snapshot.
- [x] `gateway status --deep` - Done. Appends doctor checks.
- [x] `gateway setup` - Done. Configures gateway channels.

## Model

- [x] `model` - Done. Writes model provider config through the setup writer.
- [x] `model --provider <provider>` - Done. Selects provider/profile during model setup.
- [x] `model --model <model>` - Done. Selects model during model setup.
- [x] `model --api-key <apiKey>` - Done. Writes provider API key to JSONC config.
- [x] `model --base-url <baseUrl>` - Done. Writes custom relay base URL.
- [x] `model --protocol <protocol>` - Done. Selects compatible relay protocol.

## Setup

- [x] `setup` - Done. Runs model + gateway setup.
- [x] `setup model` - Done. Runs model setup only.
- [x] `setup gateway` - Done. Runs gateway setup only.
- [x] `setup --provider <provider>` - Done. Passed to model setup.
- [x] `setup --model <model>` - Done. Passed to model setup.
- [x] `setup --api-key <apiKey>` - Done. Passed to model setup.
- [x] `setup --protocol <protocol>` - Done. Passed to model setup.
- [x] `setup --base-url <baseUrl>` - Done. Passed to model setup.
- [x] `setup --gateway-port <port>` - Done. Passed to gateway setup.
- [x] `setup --yes` / `setup -y` - Done. Skips prompts where supported.

## Status And Doctor

- [x] `status` - Done. Shows runtime, gateway, channel, memory state.
- [x] `status --deep` - Done. Appends doctor checks.
- [x] `channels` - Done. Shows Gateway channel snapshot.
- [~] `doctor` - Partial. Read-only checks implemented.
- [ ] `doctor --fix` - Todo. Safe repair actions are not implemented.
- [x] `version` - Done. Shows build/runtime version.

## Config

- [x] `config show` - Done. Text view with secret redaction.
- [x] `config show --json` - Done. Deterministic JSON view.
- [x] `config show --show-secrets` - Done. Explicit full secret view.
- [x] `config path` - Done. Prints config path.
- [x] `config env-path` - Done. Prints planned secrets path.

## Memory

- [x] `memory status` - Done. Shows configured memory state and paths.
- [~] `memory setup` - Partial. Provider choice UI exists; persistence is staged.
- [ ] `memory reset` - Todo. Confirmed reset behavior is not implemented.
- [ ] `memory reset --yes` / `memory reset -y` - Todo. Confirmation skip exists, erase action is not implemented.

## Sessions

- [x] `sessions list` - Done. Lists real session records.
- [x] `sessions list --limit <n>` - Done. Limits session rows.
- [x] `sessions list --json` - Done. Emits session JSON.
- [x] `sessions show <sessionKey>` - Done. Shows recent session messages.
- [x] `sessions show <sessionKey> --limit <n>` - Done. Limits session timeline rows.
- [x] `sessions show <sessionKey> --json` - Done. Emits timeline JSON.
- [ ] `sessions export <output>` - Todo. Export is not implemented.
- [ ] `sessions delete <sessionId>` - Todo. Delete is not implemented.
- [ ] `sessions delete <sessionId> --yes` / `sessions delete <sessionId> -y` - Todo. Confirmation skip exists, delete action is not implemented.
- [ ] `sessions prune` - Todo. Prune is not implemented.
- [ ] `sessions prune --days <days>` - Todo. Age filter is registered but not wired.
- [ ] `sessions prune --yes` / `sessions prune -y` - Todo. Confirmation skip exists, prune action is not implemented.

## Blackboard

- [x] `blackboard list` - Done. Lists recent blackboard turns.
- [x] `blackboard list --limit <n>` - Done. Limits turn rows.
- [x] `blackboard list --session <sessionKey>` - Done. Filters by session.
- [x] `blackboard list --json` - Done. Emits turn JSON.
- [x] `blackboard show <turnId>` - Done. Shows turn, workers, steps, messages.
- [x] `blackboard show <turnId> --limit <n>` - Done. Limits messages and steps.
- [x] `blackboard show <turnId> --json` - Done. Emits transcript JSON.

## Skills

- [x] `skills list` / `skills ls` - Done. Lists project-local `.flyflor/skills` and global `SKILL.md` packages.
- [x] `skills list --json` - Done. Emits installed skill metadata as JSON.
- [x] `skills show <name>` - Done. Shows resolved skill body and normalized manifest with project-local precedence.
- [x] `skills show <name> --json` - Done. Emits resolved skill metadata, manifest, and body as JSON.
- [x] `skills validate [name]` - Done. Validates one resolved skill or all installed skills.
- [x] `skills validate [name] --json` - Done. Emits validation results as JSON and exits non-zero on invalid skills.
- [x] `skills install <identifier>` - Done. Installs a local `SKILL.md` directory or exact existing skill name into project-local skills.
- [x] `skills install <identifier> --name <name>` - Done. Rewrites the installed manifest name.
- [x] `skills install <identifier> --force` - Done. Overwrites an existing project-local skill.
- [x] `skills install <identifier> --global` - Done. Installs into global `~/.flyflor/skills`.
- [x] `skills install <identifier> --yes` / `skills install <identifier> -y` - Done. Non-interactive install.
- [x] `skills reset <name>` - Done. Removes the project-local skill override, revealing lower-priority global skills when present.
- [x] `skills remove <name>` / `skills rm <name>` - Done. Alias of `skills reset <name>`.
- [x] `skills reset <name> --global` - Done. Removes the global skill.
- [x] `skills reset <name> --yes` / `skills reset <name> -y` - Done. Non-interactive reset.
- [x] Runtime skill usage summary - Done. Records selected skill use into project-local `.flyflor/skills/skill.usage.jsonl` and `.flyflor/skills/skill.usage.summary.json`.
- [ ] `skills usage [name]` - Todo. CLI view for project-local skill usage counters is not implemented yet.
- [ ] `skills usage [name] --json` - Todo. JSON view for skill usage counters is not implemented yet.

## Tools

- [ ] `tools enable <toolsets...>` - Todo. Enable toolsets in config.
- [ ] `tools enable <toolsets...> --mcp-server <name>` - Todo. Enable MCP server toolset.
- [ ] `tools disable <toolsets...>` - Todo. Disable toolsets in config.
- [ ] `tools disable <toolsets...> --mcp-server <name>` - Todo. Disable MCP server toolset.

## MCP

- [x] `mcp list` / `mcp ls` - Done. Lists configured MCP servers from JSONC config.
- [x] `mcp list --json` - Done. Emits configured MCP servers as JSON.
- [x] `mcp show <name>` - Done. Shows resolved MCP server config with secret env values redacted in text output.
- [x] `mcp show <name> --json` - Done. Emits resolved MCP server config as JSON.
- [x] `mcp validate [name]` - Done. Validates one resolved server or all resolved servers.
- [x] `mcp validate [name] --json` - Done. Emits validation results as JSON and exits non-zero on invalid servers.
- [x] `mcp add <name>` - Done. Adds or updates an MCP server in project-local `.flyflor/mcp/mcp.json`.
- [x] `mcp add <name> --url <url>` - Done. Adds a remote HTTP/SSE endpoint.
- [x] `mcp add <name> --command <command>` - Done. Adds a stdio MCP command.
- [x] `mcp add <name> --args <args...>` - Done. Adds command args.
- [x] `mcp add <name> --env <env...>` - Done. Adds command env entries without printing values in table output.
- [x] `mcp add <name> --global` - Done. Writes global `~/.flyflor/mcp/mcp.json`.
- [x] `mcp add <name> --yes` / `mcp add <name> -y` - Done. Non-interactive add.
- [x] `mcp enable <name>` - Done. Enables a project-local MCP server entry.
- [x] `mcp enable <name> --global` - Done. Enables a global MCP server entry.
- [x] `mcp disable <name>` - Done. Disables a project-local MCP server entry.
- [x] `mcp disable <name> --global` - Done. Disables a global MCP server entry.
- [x] `mcp remove <name>` / `mcp rm <name>` / `mcp delete <name>` - Done. Removes a project-local MCP server entry.
- [x] `mcp remove <name> --global` - Done. Removes a global MCP server entry.
- [x] `mcp remove <name> --yes` / `mcp remove <name> -y` - Done. Non-interactive remove.
- [x] `mcp tools <name>` - Done. Starts a stdio MCP server, initializes it, and lists `tools/list`.
- [x] `mcp tools <name> --json` - Done. Emits MCP tool metadata as JSON.
- [x] `mcp tools <name> --timeout <ms>` - Done. Applies request timeout.
- [x] `mcp call <name> <tool>` - Done. Calls a stdio MCP tool with object input.
- [x] `mcp call <name> <tool> --input <json>` - Done. Parses JSON object tool input.
- [x] `mcp call <name> <tool> --json` - Done. Emits raw MCP call result as JSON.
- [x] `mcp call <name> <tool> --timeout <ms>` - Done. Applies request timeout.
- [x] Runtime MCP tool call block - Done. Model can request MCP execution through a structured `<flyflor_mcp_calls>` JSON block; runtime executes only configured tools allowed by sandbox and feeds results back before the final answer.
- [x] Runtime MCP catalog cache - Done. Runtime caches stdio `tools/list` results for a short TTL to avoid repeated discovery in hot turns.
- [x] Runtime MCP Streamable HTTP client - Done. Remote URL servers support `initialize`, `tools/list`, `tools/call`, `Mcp-Session-Id`, JSON responses, and SSE event responses.
- [x] Runtime Skill/MCP provenance - Done. Runtime emits skill/catalog/call events and writes selected skills plus MCP call summaries into episode metadata/reflection evidence.
- [x] `sandbox.mcpToolApproval` - Done. Configurable `deny` / `ask` / `allow` policy controls MCP tool execution approval.
- [x] `sandbox.shellHookApproval` - Done. Configurable `deny` / `ask` / `allow` policy is available for future shell hook executors.
- [x] `sandbox.pluginApproval` - Done. Configurable `deny` / `ask` / `allow` policy is available for future plugin executors.

## Plugins

- [ ] `plugins install <identifier>` - Todo. Install plugin.
- [ ] `plugins install <identifier> --force` / `plugins install <identifier> -f` - Todo. Reinstall plugin.
- [ ] `plugins list` / `plugins ls` - Todo. List plugins.
- [ ] `plugins update <name>` - Todo. Update plugin.
- [ ] `plugins remove <name>` / `plugins rm <name>` / `plugins uninstall <name>` - Todo. Remove plugin.

## Dream

- [x] `dream status` - Done. Shows dream snapshot and queue sizes.
- [x] `dream run` - Done. Runs one dream pass.
- [x] `dream run --limit <n>` - Done. Limits pass size.
- [x] `dream run --user <userId>` - Done. Scopes pass to one user.

## Update

- [ ] `update` - Todo. Update Flyflor.
- [ ] `update --check` - Todo. Check for update.
- [ ] `update --yes` / `update -y` - Todo. Non-interactive update.

## Validation Log

- `bun run check`
- `bun test tests/command.boundaries.test.ts tests/config.view.test.ts`
- `bun test tests/skill.mcp.test.ts tests/command.boundaries.test.ts`
- `bun test tests/skill.mcp.test.ts tests/runtime.perf.test.ts tests/decay.anti.bloat.project.test.ts tests/reflection.boundaries.test.ts`
- `bun test tests/skill.mcp.test.ts tests/runtime.perf.test.ts`
- `bun run test`
- `bun run build:binary`

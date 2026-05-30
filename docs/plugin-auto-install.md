# Plugin Auto-Install Design

## Purpose

Flyflor must run as a complete project-local agent kernel. External plugin
availability is owned by this repository, not by the user's global machine
state.

## Runtime Contract

- Install external plugins under `./plugins`.
- Keep plugin status, locks, logs, and diagnostics under `.config/plugins`.
- Keep RTK configuration and plugin-local tool state under `.config/tools/rtk`.
- Keep RTK raw output artifacts under the configured tool-artifact root,
  usually `.config/memory/artifacts/rtk`.
- Keep CodeGraph indexes under `.config/codegraph`.
- Never resolve enabled plugins from global `PATH` as the normal runtime path.
- Emit brain and socket diagnostics for install, repair, missing, unavailable,
  and failed states.

## Registry Shape

`.config/config.jsonc` owns plugin registry configuration. Each external plugin
entry defines its project-local install path, source, pinned ref, executable
resolution hints, and whether it is required for startup or only for a feature
lane.
Entries may also define `installCommands`. These commands run inside that
plugin's own `./plugins/<name>` directory after clone/copy, never from the
project root.
Each command is bounded by `installTimeoutSeconds`; timeout is reported as an
install failure. Runtime must expose that failure instead of substituting a
different execution path.

`plugins.autoInstall` controls whether a profile may perform network or local
copy installation. Normal runtime config enables it; isolated scenario profiles
may disable it so tests verify explicit unavailable diagnostics without mutating
`./plugins`.

## Install Flow

1. `PluginInstallerComponent.ensurePlugin(name)` reads the registry entry.
2. The installer checks `.config/plugins/plugin-lock.json` and the filesystem.
3. Missing or invalid plugins are installed into `./plugins/<name>`.
4. Optional plugin-local install/build commands run inside `./plugins/<name>`.
5. The installer verifies the expected command using the project-local path.
6. The installer writes status and diagnostics under `.config/plugins`.
7. Adapters execute only the verified local command.

## Failure Flow

Plugin install failure does not block ordinary chat, memory, file reads, or
basic tool execution. The adapter returns an explicit unavailable or failed
diagnostic for the plugin-backed tool and does not pretend that another tool
completed the plugin request.

Failure is not silent. The debug panel and brain audit must show the plugin
name, install path, failure reason, and whether user action is needed.

Scenario profiles may point `paths.externalPluginsDir` at an isolated runtime
directory and set `plugins.autoInstall=false`. That verifies unavailable
behavior without reading global commands or mutating the normal `./plugins`
tree.

## RTK

RTK is the tool-output attention filter. It is used for command output that
would otherwise waste model context: git, tests, build logs, lint, grep/find,
docker, kubectl, and similar noisy commands.

RTK tee/raw output belongs under the configured tool-artifact root, usually
`.config/memory/artifacts/rtk`, so model-facing summaries can stay compact while
raw evidence remains reviewable. `.config/tools/rtk` remains available for RTK
configuration, plugin status hints, and tool-local cache metadata.

## CodeGraph

CodeGraph is the code-structure attention filter. It is used only when the turn
planner marks the turn as coding, codebase reasoning, symbol tracing, or impact
analysis.

CodeGraph indexes belong under `.config/codegraph`. If the upstream tool cannot
honor an external index directory, the adapter must stop with a clear diagnostic
rather than create root-level `.codegraph` state.

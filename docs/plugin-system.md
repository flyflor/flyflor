# Plugin System Design

## Purpose

Plugins are optional runtime extensions. They must improve exploration or execution without becoming hard dependencies of the Bun binary.

## Naming

The project uses `plugins` for this layer because it matches the expected ecosystem language and clearly separates optional external capabilities from built-in tools.

## Directories

- `src/plugins`: plugin host, decorators, manifests, adapters, and bridges.
- `src/tools`: built-in tools.
- `./plugins`: project-local external plugin source, binaries, shims, and vendored runtime files.
- `.config/plugins`: plugin state, manifests, cache, and diagnostics.

## Project-Local Installation

Flyflor is an independent agent kernel. External plugins must not depend on
tools installed globally on the user's machine. Runtime code must resolve RTK,
CodeGraph, and future external plugins from `./plugins` only.

`PluginInstallerComponent` owns installation and repair:

1. Read plugin registry entries from `.config/config.jsonc`.
2. Check whether `./plugins/<plugin-name>` exists and contains the expected executable or adapter.
3. Install missing plugins into `./plugins` using the pinned registry source.
4. Write install status, resolved command, commit/version, and diagnostics under `.config/plugins`.
5. Refuse to silently fall back to a global command when project-local installation fails.

Global tools may be useful for developer debugging, but they are not part of
Flyflor's runtime contract.

## Decorator

`@Plugin()` marks a DI provider that contributes plugin behavior. It does not mark ordinary internal tools.

Plugin classes may:

- expose a manifest,
- contribute tool definitions,
- bridge to an external command,
- report availability,
- provide diagnostics.

Plugin manifests are merged deterministically by plugin name and deduped tool
name. Built-in adapters remain the stable model-visible surface when an
external plugin backs the same capability, such as the `codegraph` tool.

## CodeGraph And RTK

CodeGraph and RTK are project-local external integrations:

- CodeGraph improves symbol and dependency exploration.
- RTK compresses or structures noisy tool output.
- Both must be auto-installed to `./plugins` when enabled and missing.
- If either plugin is unavailable or fails, its tool result must fail
  explicitly and emit diagnostics. Runtime must not silently substitute
  internal `rg`, `glob`, `read`, or bounded raw output as if the plugin
  succeeded.

RTK is the command-output attention filter for shell, git, test, build, and
diagnostic commands. Its tee/raw artifacts must live under the configured
tool artifact directory, usually `.config/memory/artifacts/rtk` or an isolated
scenario profile equivalent.

CodeGraph is the coding-intent structure index. It must trigger only for
codebase reasoning, code modification, impact analysis, or symbol tracing.
Indexes and cache state must live under `.config/codegraph`.

## Acceptance

Plugin absence must never prevent unrelated core agent capabilities such as
chatting, reading files, editing files, or using memory. Plugin install
attempts, resolved local commands, failures, unavailable states, and
availability must be visible in socket debug events and brain audit records.

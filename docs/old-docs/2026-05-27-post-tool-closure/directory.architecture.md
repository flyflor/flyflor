# Directory Architecture

## Principle

Directories are architecture contracts. A path must show ownership, lifecycle and side-effect boundaries before configuration or reuse tries to explain them.

Flyflor code keeps OOP + use composition:

- Business owners are classes, Components, Modules, Repos and Workers.
- Cross-class assembly lives in `composition.ts` and uses `useXxx()`.
- `index.ts` is a barrel, not an implementation owner.
- Small duplication inside the correct owner is preferable to a cross-domain helper with unclear lifecycle.

## Top-Level Source Owners

| Path | Owner |
| --- | --- |
| `src/app.ts` | FlyFlor composition root. |
| `src/agent` | Runtime, Blackboard, context, sandbox, prompts, skills, MCP, plugins and workers. |
| `src/cognitive` | Mindstream, Crystal and Hippocampus. |
| `src/executive` | Capability / Tool / Trust / Loop. |
| `src/socket` | Socket vascular layer for `/ws`, `/health`, control/event and query snapshots. |
| `src/events` | Runtime event fabric. |
| `src/protocol` | Serializable contracts and wire envelopes. |
| `src/protocol/control` | `/ws` control/event envelopes and external thin-client protocol readers. |
| `src/config` | JSONC config loading and defaults. |
| `src/entities` | Entity mapping and repo SQL. |
| `src/components` | Shared Component bases and truly cross-domain infrastructure. |
| `src/types` | Small global type barrel only. |

## Agent

| Path | Role |
| --- | --- |
| `src/agent/runtime` | `RuntimeModule.handleMessage`, turn assembly, planning, routing, MCP/tool wiring, subagents and streaming. |
| `src/agent/context` | Explicit `activeScope`, `contextForkId`, scope paths and continuity-owner derivation. |
| `src/agent/blackboard` | Blackboard module/store and worker composition. |
| `src/agent/sandbox` | Approval, quota, shell hook, audit and side-effect policy. |
| `src/agent/mcp` | MCP stdio/SSE/HTTP transports, catalog and schema validation. |
| `src/agent/plugin` | Plugin registry and runner. |
| `src/agent/skills` | `SKILL.md` registry and selection surface. |
| `src/agent/prompts` | Template loading/rendering from `templates/prompts`. |
| `src/agent/worker` | Worker manager and blackboard worker threads. |
| `src/agent/di` | Decorator metadata and explicit dependency container. |

`src/agent/context` deliberately uses the current turn id when no scope/fork/codename exists. Conversation/thread/user metadata is not cognitive continuity.

## Cognitive

| Path | Role |
| --- | --- |
| `src/cognitive/mindstream` | Model provider clients and protocol conversion. |
| `src/cognitive/hippocampus/ask` | Structured ASK block parsing. |
| `src/cognitive/hippocampus/continuation` | Continuation decisions and ghost snapshots. |
| `src/cognitive/hippocampus/memory` | Memory module, brain ledger store, working memory, hot memory, recall, decay, dream, consolidation, summary, scope memory and fork stores. |
| `src/cognitive/hippocampus/scope` | Scope triggers, scaffolding, solidification, codename promotion and recall. |
| `src/cognitive/crystal` | Crystal memory, Gem store and reflection promotion. |

## Socket

`src/socket/module.ts` owns server startup and the HTTP surface. `src/socket/control.ts` owns the WebSocket control hub. `src/socket/query` reads ledger/detail snapshots for socket clients.

Rules:

- Do not add REST status surfaces beyond `/health`.
- Do not restore `/channels`.
- Do not make `gateway.*` names architecture owners; they are wire-v1 compatibility strings.

## Executive

`src/executive` contains `registry.ts`, `planner.ts`, `tool.runtime.ts`, `trust.policy.ts`, `loop.guard.ts`, `manifest.ts`, `mcp.adapter.ts`, `computer.profile.ts` and `sidecar/runner.ts`.

This layer does not read natural language to infer intent. It consumes descriptors, config, channel capabilities, sandbox state, approvals and numeric loop metrics.

## Runtime Data Paths

| Path | Role |
| --- | --- |
| `~/.flyflor/.config/config.jsonc` | Main JSONC config. |
| `./docker/config/config.jsonc` | Docker dev config. |
| `~/.flyflor/.config/prompts` | Installed prompt templates. |
| `~/.flyflor/.config/templates/memory` | Installed memory templates. |
| `~/.flyflor/.config/workspace` | Global Markdown constitution files. |
| current-month `brain.db` | Writable life ledger. |
| `brain/archive/` | Read-only historical ledger shards. |
| `<scope.projectDir>/.flyflor/` | Scope-local memory, skills, MCP and plugin surface. |

## Naming

- Directory entry: `index.ts`.
- Single owner component in a directory: `component.ts`.
- Role suffixes: `module.ts`, `store.ts`, `repo.ts`, `worker.ts`, `manager.ts`, `adapter.ts`, `runner.ts`, `route.ts`.
- Prompt/template files use dot suffixes such as `blackboard.route.md` and `blackboard.route.zh.cn.md`.
- Do not add `*.exports.ts`.
- Do not add new hyphenated or underscored repository file names.

## Retired Paths

These paths are not active owner surfaces and must not be recreated as compatibility shells:

- `src/fch`
- old execution-layer physical paths
- `src/skills`
- `src/context`
- `src/agent/gateway`
- first-party Bun CLI/TUI/channel adapter implementation surfaces

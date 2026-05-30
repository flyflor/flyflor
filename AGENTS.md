# Flyflor Engineering Red Lines

This file is the source of truth for coding agents working in this repository.
When implementation and this file disagree, update this file through discussion before changing code.

## Language And Engineering Baseline

- Use Chinese for project discussion when interacting with the owner.
- Follow `karpathy-guidelines` before coding, review, refactor, bug fixing, tests, or engineering decisions.
- Documentation comes before implementation.
- Before adding or changing runtime behavior, update the relevant design document under `docs`.
- Do not start workmux lanes or feature implementation until the matching document is written and reviewed.
- Do not describe core agent work as a temporary minimal stage when the owner asks for a complete coding agent plan.
- Plans must account for full no-session continuity: brain audit, memory recovery, context compaction, tool loop, plugin boundaries, and observable socket events.
- Prefer simple, explicit, convention-first code over configurable frameworks.
- OOP is the default for long-lived runtime capabilities.
- Composition APIs are allowed only when they return a cohesive capability object with clear state and behavior.
- Avoid loose procedural function sprawl.
- Repeated code is acceptable when it keeps boundaries clear.
- All tests must use the configured real LLM provider path. Do not add mock,
  fake, stub, or deterministic model providers for tests.
- Missing real LLM credentials are a test failure, not a reason to skip a test.
- Do not add fallback logic that continues execution through a substitute path.
  Failures must be explicit, observable, and audited; error details must not be
  swallowed.
- TypeScript source, declaration, and test filenames must use dot-case such as
  `agent.runtime.service.ts`. Do not add hyphenated TypeScript filenames such as
  `agent-runtime.service.ts`.

## Directory Red Lines

- `src/di`: DI decorators, metadata registry, container bootstrap.
- `src/signal`: `SignalModule`, `SignalBus`, signal contracts, guard/confirm flow.
- `src/socket`: external WebSocket adapter only.
- `src/kernel`: agent runtime orchestration.
- `src/brain`: monthly full-fidelity audit and biography database.
- `src/config`: config loader and typed config access.
- `src/entities`: `@Repo()` classes for data model and SQL operations.
- `src/plugins`: plugin host, plugin manifests, and external plugin adapters.
- `src/shared`: shared types, errors, and small cross-cutting utilities.
- `prompts`: runtime prompt files.
- `sql`: initialization schema and seed SQL files.
- `.config/config.jsonc`: single project config source.
- `docs`: design documents that must be written before implementation.

Do not create competing root-level app structures without updating this file.

## Config Asset Red Lines

- `.config` is the unified root for local configuration, local data, templates, tool caches, test pages, runtime locks, and scenario-test profiles.
- Do not add root-level local asset directories such as `.flyflor`, `templates`, `.codegraph`, or `public`.
- Keep source code in `src`, design documents in `docs`, runtime prompts in `prompts`, initialization SQL in `sql`, and all local assets under `.config`.
- `.config/templates` stores constitutional agent templates such as `SOUL.md`, `USER.md`, and `MEMORY.md`.
- `.config/memory` stores `memory.db`, memory wiki projection, memory artifacts, and memory job state.
- `.config/brain` stores monthly `YYYY-MM.brain.db` audit databases and full-fidelity artifacts.
- `.config/plugins` stores plugin manifests, runtime status, and plugin caches.
- `.config/web` stores local test pages such as the WebSocket test page.
- `.config/codegraph` stores CodeGraph indexes and cache state.
- `.config/tools` stores tool configuration for RTK, CodeGraph, shell, git, file edits, and guard policy.
- `.config/runtime` stores runtime-only locks, pid files, materialized dynamic libraries, and temporary process state.
- All committed paths inside config must be relative to the project root.
- Shared or local generated data must not leak into new root directories.

## Worktree And Cmux Red Lines

- Parallel development must use a workmux-style workflow.
- Each concurrent lane must use an independent git worktree under `./.worktrees/<lane-name>`.
- Each child Codex agent must run in a visible `cmux` pane.
- When running inside Ghostty, do not use `cmux` to launch worktree child
  windows. Stop and report the terminal blocker instead of creating hidden
  child processes or substituting another background workflow.
- After launching a child Codex agent, the coordinator must verify the child process state through visible `cmux` inspection such as `cmux read-screen`.
- A pane being created, a shell command returning, or a process existing is not enough to claim the child Codex is ready.
- The coordinator must confirm the child is inside the Codex TUI, has received the lane prompt, has read the required rules, and is either working, blocked, or ready for handoff.
- Do not launch hidden child Codex processes for reviewable implementation work.
- Do not silently fall back to background processes when `cmux` is unavailable; stop and report the blocker.
- Before launching a child agent, the coordinator must define the lane name, worktree path, branch, owned files, forbidden files, validation commands, and handoff conditions.
- Child agents must stay inside their owned file surface and stop for coordinator input before crossing ownership boundaries.
- The coordinator owns task distribution, worktree setup, child-process state audit, review, validation, final merge, and any main-worktree integration.
- The coordinator must not implement feature code or bug-fix code in the main worktree during a parallel workmux task.
- The coordinator may only edit coordination artifacts, review notes, merge-conflict resolutions, or explicitly user-authorized emergency fixes while acting as coordinator.
- Child agents must not merge directly into the main worktree.
- When a child Codex lane completes, is stopped, or is abandoned, the coordinator must record the final state and close the visible child pane when it is no longer needed for review.
- If a child Codex lane drifts outside scope, enters an unexpected UI state, or cannot prove its current state, the coordinator must stop treating that lane as valid implementation evidence until it is inspected and corrected.

Each worktree must have these control files:

- `AGENTS.md`
  - Single source of repository red lines.
  - Must be read by every child agent.
  - Read-only for child agents; they must not modify it.
- `PLAN.md`
  - Written by the coordinator for the specific lane.
  - Must include the lane goal, scope, forbidden surfaces, validation commands, and handoff requirements.
  - Read-only for child agents.
- `TODO.md`
  - Owned by the child agent inside that worktree.
  - Child agents may append items and update item status.
  - Child agents must not delete, rewrite, or mutate existing content beyond status updates.
- `LOGS.md`
  - Owned by the child agent inside that worktree.
  - Append-only list of changed files and reasons.
  - Child agents must not delete or rewrite existing log entries.
- `STATUS.md`
  - Owned by the child agent inside that worktree.
  - Records progress, blockers, validation results, and handoff state.
  - Child agents may append updates or update the current status section.

Control file merge rules:

- By default, only valid appended content from `LOGS.md` is merged back as control history.
- `TODO.md` and `STATUS.md` remain worktree handoff evidence unless the coordinator explicitly decides otherwise.
- Business code changes are still reviewed, validated, and merged by the coordinator.

Dependency and config rules for worktrees:

- The coordinator decides per lane whether dependencies, config, or caches are symlinked or copied.
- Shared config such as `.config/config.jsonc` should be symlinked or copied read-only when needed.
- Child agents must not mutate coordinator-owned shared config unless their `PLAN.md` explicitly allows it.
- Do not symlink code or writable control files in a way that lets a child agent accidentally write into the coordinator worktree.

## DI And Decorator Red Lines

- Use a project-owned lightweight DI system.
- Do not use Inversify, TSyringe, Socket.IO, or reflect-metadata as core runtime dependencies.
- Do not add scope enums, `@Transient()`, or `@Optional()`.
- Do not infer injection types from decorator metadata.
- Use explicit binding and injection.

Required decorators:

- `@Module({ imports, providers, exports })`
  - Declares module assembly only.
  - Must not contain business logic.
- `@Provide(base?)`
  - Registers a class as a provider.
  - `@Provide()` binds the class to itself.
  - `@Provide(Base)` explicitly binds `Base` to the class.
  - Do not auto-bind inherited base classes.
- `@Inject(tokenOrClass)`
  - Property injection only.
  - Always pass the token or class explicitly.
- `@Service()`
  - Business flow, runtime capability, and orchestration class.
- `@Component()`
  - Infrastructure capability class, such as database, memory, context compressor, model adapter, or prompt loader.
- `@Repo()`
  - Data model and SQL operation class under `src/entities`.
- `@Plugin()`
  - Plugin provider class under `src/plugins`.
  - Use for adapters that bridge optional external plugins from `./plugins`.
  - Do not decorate every internal tool as a plugin.
- `@Prompt(relativePath)`
  - Injects prompt text from `prompts/*.md`.
  - Runtime code only loads `.md`.
  - `.zh.cn.md` files are human-maintained Chinese mirrors and are not loaded by runtime code.
- `@Subscribe(signalName)`
  - Registers a method as a `SignalBus` subscriber during DI lifecycle wiring.

## Signal Layer Red Lines

- The module name is `SignalModule`.
- The core service name is `SignalBus`.
- `SignalBus` is the vascular layer for runtime coordination.
- It must support subscribe, emit, guard/ask, complete, final, fail, timeout, and future retry flows.
- RxJS may be used inside `src/signal`.
- Do not expose RxJS as the default public API of the kernel.
- External callers should use project-owned methods such as `emit`, `subscribe`, and `ask`.
- Guard and confirm flows must pass through `SignalBus`, even when local development auto-approves.

## Prompt Red Lines

- Runtime prompt text must not be embedded in TypeScript files.
- Every prompt must have both files:
  - `name.md`
  - `name.zh.cn.md`
- Runtime uses only `.md`.
- Chinese `.zh.cn.md` files are documentation mirrors.

## Config Red Lines

- All committed config paths must be relative paths.
- `.config/config.jsonc` owns model config, tool config, socket config, prompt paths, and runtime flags.
- Do not scatter config across multiple files unless this file is updated first.

## Brain And Memory Red Lines

- `brain.db` and `memory.db` have different jobs and must not be conflated.
- `brain.db` is a monthly full-fidelity biography/audit log under `.config/brain/YYYY-MM.brain.db`.
- `brain.db` stores all visible conversation content, socket events, tool events, model deltas, visible reasoning summaries, sub-agent handoff logs, recovery records, and artifact references.
- `brain.db` is not compressed and is not the hot recall path.
- Do not claim to store hidden chain-of-thought that a model provider does not expose. Store visible reasoning summaries, tool traces, and Flyflor's own structured work records.
- `memory.db` is the current working memory under `.config/memory/memory.db`.
- `memory.db` owns facts, decisions, claims, tasks, entities, relations, vector chunks, retrieval traces, context checkpoints, and recovery state.
- Every turn must write enough durable state for process crash, terminal close, network loss, or machine shutdown recovery.
- `memory.db` must be rebuildable from `brain.db` for critical indexes, but `brain.db` must not be replaced by `memory.db`.
- Context compaction may rewrite model-facing history, but it must never delete brain audit data.

## Plugin Red Lines

- `src/tools` is for internal tools compiled into the Bun binary.
- `src/plugins` is for plugin host code and adapters.
- `./plugins` is for external plugin code, binaries, or symlinks such as CodeGraph and RTK integrations.
- External plugins must not be Bun binary hard dependencies.
- Missing external plugins must return explicit unavailable or failed diagnostics
  instead of silently substituting another execution path.

## Repo And SQL Red Lines

- `@Repo()` classes live under `src/entities`.
- Repo methods own SQL reads and writes.
- Simple SQL may be inline in repo methods.
- Complex review-worthy SQL should be placed in `.sql` files.
- CREATE/init schema SQL must live in the root `sql` directory.

## Socket Red Lines

- Use Bun native WebSocket.
- `src/socket` is an external adapter and must not own kernel behavior.
- Use a project-owned JSON envelope with `id`, `type`, `payload`, and `timestamp`.
- Keep the protocol ready for a future Rust TUI shell.

## Documentation Red Lines

- Every class, composition API, interface, and enum must have JSDoc.
- JSDoc must explain purpose, input meaning, output meaning, and usage.
- Comments should clarify intent and contracts, not repeat obvious code.

## Build And Test Red Lines

- Bun binary packaging is a hard requirement.
- Performance is a high-priority engineering criterion.
- Use mature existing libraries for general-purpose capabilities such as env loading, JSON/JSONC parsing, protocol parsing, formatting, and stable utility behavior when they are compatible with Bun binary packaging and meet performance needs.
- Do not hand-roll common parsing or utility behavior merely to avoid dependencies.
- Before adding a dependency to core runtime, verify that it is Bun-compatible, binary-packaging friendly, actively maintained enough for the risk, API-simple, and not a heavy framework hidden behind a small feature.
- Lightweight libraries with acceptable performance may be used directly.
- Libraries that fail performance, startup-cost, memory, transitive-dependency, or Bun binary compatibility checks must not be used in core runtime.
- Project-owned implementations are appropriate for hot paths, binary-packaging constraints, architecture boundaries, or behavior that existing libraries cannot satisfy; the reason must be clear in code review or design docs.
- Tests must call the configured real LLM provider path and must not use mock,
  fake, stub, or deterministic model providers.
- Tests must fail when required real model credentials are unavailable.
- Scenario tests must use isolated config/profile data and must not mutate normal runtime state.

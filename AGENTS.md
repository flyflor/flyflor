# Flyflor Engineering Red Lines

This file is the source of truth for coding agents working in this repository.
When implementation and this file disagree, update this file through discussion before changing code.

## Language And Engineering Baseline

- Use Chinese for project discussion when interacting with the owner.
- Follow `karpathy-guidelines` before coding, review, refactor, bug fixing, tests, or engineering decisions.
- Documentation comes before implementation.
- Before adding or changing runtime behavior, update the relevant design document under `.config/docs`.
- Do not start workmux lanes or feature implementation until the matching document is written and reviewed.
- Prefer simple, explicit, convention-first code over configurable frameworks.
- OOP is the default for long-lived runtime capabilities.
- Composition APIs are allowed only when they return a cohesive capability object with clear state and behavior.
- Avoid loose procedural function sprawl.
- Repeated code is acceptable when it keeps boundaries clear.

## Directory Red Lines

- `src/di`: DI decorators, metadata registry, container bootstrap.
- `src/signal`: `SignalModule`, `SignalBus`, signal contracts, guard/confirm flow.
- `src/socket`: external WebSocket adapter only.
- `src/kernel`: agent runtime orchestration.
- `src/config`: config loader and typed config access.
- `src/entities`: `@Repo()` classes for data model and SQL operations.
- `src/shared`: shared types, errors, and small cross-cutting utilities.
- `prompts`: runtime prompt files.
- `sql`: initialization schema and seed SQL files.
- `.config/config.jsonc`: single project config source.
- `.config/docs`: design documents that must be written before implementation.

Do not create competing root-level app structures without updating this file.

## Config Asset Red Lines

- `.config` is the unified root for local configuration, local data, templates, tool caches, test pages, runtime locks, and scenario-test profiles.
- Do not add root-level local asset directories such as `.flyflor`, `templates`, `.codegraph`, or `public`.
- Keep source code in `src`, runtime prompts in `prompts`, initialization SQL in `sql`, and all local assets under `.config`.
- `.config/templates` stores constitutional agent templates such as `SOUL.md`, `USER.md`, and `MEMORY.md`.
- `.config/memory` stores `memory.db`, memory wiki projection, memory artifacts, and memory job state.
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
- Do not launch hidden child Codex processes for reviewable implementation work.
- Do not silently fall back to background processes when `cmux` is unavailable; stop and report the blocker.
- Before launching a child agent, the coordinator must define the lane name, worktree path, branch, owned files, forbidden files, validation commands, and handoff conditions.
- Child agents must stay inside their owned file surface and stop for coordinator input before crossing ownership boundaries.
- The coordinator owns review, validation, final merge, and any main-worktree integration.
- Child agents must not merge directly into the main worktree.

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
- Do not use Inversify, TSyringe, Socket.IO, or reflect-metadata as core runtime dependencies in v1.
- Do not add scope enums, `@Transient()`, or `@Optional()` in v1.
- Do not infer injection types from decorator metadata in v1.
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
  - Property injection only in v1.
  - Always pass the token or class explicitly.
- `@Service()`
  - Business flow, runtime capability, and orchestration class.
- `@Component()`
  - Infrastructure capability class, such as database, memory, context compressor, model adapter, or prompt loader.
- `@Repo()`
  - Data model and SQL operation class under `src/entities`.
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
- Do not expose RxJS as the default public API of the kernel in v1.
- External callers should use project-owned methods such as `emit`, `subscribe`, and `ask`.
- Guard and confirm flows must pass through `SignalBus`, even when v1 auto-approves.

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

## Repo And SQL Red Lines

- `@Repo()` classes live under `src/entities`.
- Repo methods own SQL reads and writes.
- Simple SQL may be inline in repo methods.
- Complex review-worthy SQL should be placed in `.sql` files.
- CREATE/init schema SQL must live in the root `sql` directory.

## Socket Red Lines

- Use Bun native WebSocket in v1.
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
- Avoid dependency-heavy abstractions before measured need.
- Tests should prioritize real-model scenario coverage over method-level unit tests.
- Scenario tests must use isolated config/profile data and must not mutate normal runtime state.

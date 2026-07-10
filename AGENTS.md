# AGENTS.md - Flyflor Project Rules

Flyflor uses the project-local `.agents/skills/oop-code-redlines/SKILL.md` skill as its default engineering discipline. Load it before writing, reviewing, refactoring, debugging, testing, or documenting repository code. These repository rules take precedence when they are stricter.

## Kernel Principle

Flyflor is a continuously living, sessionless intelligent entity. Every design must serve understanding the user's need, investigating facts, summarizing evidence, and completing the task accurately.

- Synapse is the singleton cortex.
- Context is the singleton and sole Turn owner.
- An Agent is one persistent person in the Agent pool.
- Memory is bounded temporary memory private to that person and never owns Turn.
- Tools execute concrete actions directly.

## Code Rules

1. Code is the source of truth. Documentation describes implemented behavior.
2. Runtime code is OOP-first. Behavior belongs on classes extending the correct base: `FModule`, `FService`, `FComponent`, `FAgent`, `FCortex`, or `FTool`.
3. Exported functions are limited to decorators, bootstrap, scripts, protocol adapters, and low-level framework helpers.
4. Method bodies have a 300-line soft limit and a 500-line hard limit. Extract only real object actions, reused behavior, isolated side effects, or actual phases.
5. Source domains are `core`, `config`, `prompt`, `model`, `agent`, `neural`, `tool`, and `transport`; `src/app.ts` and `src/bootstrap.ts` are the composition boundaries.
6. Directory names are one lowercase English word. Filenames describe local roles. `index.ts` is a barrel only.
7. Do not add generic utils, manager, parser, compiler, diagnostic, event framework, XML service, or session directory.
8. Use `@/*` imports across domains and relative imports inside one directory boundary.
9. Every runtime class, constructor, method, and accessor has concise EN/ZH JSDoc explaining ownership, lifecycle, or input/output.

## Strict Failure Rules

1. CatchClause, `.catch()`, rejection fallback handlers, swallowed errors, friendly fallback replies, protocol fallback, and endpoint fallback are forbidden in source, scripts, and tests.
2. Cleanup-only `try/finally` is allowed when it does not change the rejection.
3. Tool failures reject unchanged. Spawn errors reject; non-zero exits and timeouts remain explicit process data.
4. Missing configuration, prompt files, prompt mappings, XML blocks, socket connections, switch branches, and invalid model/tool JSON reject immediately.
5. Observable and IOC lifecycle rejections propagate unchanged. The affected circuit is fail-stop.

## Dependency Rules

1. Business dependencies flow `app -> neural -> agent -> model/tool`.
2. Neural may depend on Transport; Transport never imports Neural.
3. Agent never imports Neural. Signals cross through `AgentBus` and stable discriminated structures in Agent.
4. Model and Tool do not depend on each other. Agent cognition composes their structural contracts.
5. Core, Config, and Prompt are shared infrastructure, not shortcuts around business ownership.

## IOC And Lifecycle

1. `reflect-metadata` loads before decorated classes.
2. Bootstrap calls `Factory.create(AppModule)`; `@Init` owns lifecycle wiring.
3. Only IOC constructs application classes. Outside the container use `useContainer().getAsync()` or `useContainer().create()`.
4. Decorators are limited to `Module`, `Provide`, `Singleton`, `Inject`, `Scope`, `Init`, `Config`, and `Prompt`.
5. Singleton objects are cached only after injection and Init succeed.
6. Each persistent Agent receives one isolated resolution scope. Its Brain, Callosum, Investigation, Identity, Memory, and Model are reused inside that scope and isolated from other people.
7. Synapse retains one Agent for every complete configured profile and never mutates shared profile configuration.

## Neural Boundaries

1. Observable extends FlyFlor and exposes only `pipe`, `switch`, `subscribe`, and FIFO `next`.
2. Synapse owns independent sensory, interaction, delegation, and expression circuits.
3. Ask and Confirm share the serial interaction circuit. Task uses delegation. Reply and root Complete use expression.
4. Agent stimuli enter that person's private FIFO. The same person thinks serially; different people may investigate concurrently.
5. Callosum perceives each root input exactly once and returns `reply`, `research`, or `soul`.
6. Investigation builds Ask, Confirm, Task, and Complete branches once in Init. Delegated runs do not receive Task.
7. Filesystem, Shell, and Execute are direct actions, not neural signals.

## Context And Memory

1. Turn exists only under `src/agent/context`, is never barrel-exported, and is created or modified only by Context.
2. External callers receive copied `ContextBrief` and `TurnSummary` structures.
3. Complete is the final summary and Context stores it directly without a settlement model call.
4. Memory stores only bounded notes for its owning Agent. It has no Turn, status, provider replay, or session state.
5. Reconnects and browser refreshes reset only transport state.

## Prompt Rules

1. PromptService is the only prompt-package and XML rendering boundary. Do not add XmlService or hand-written dynamic XML.
2. Runtime loads canonical English `.md` files and ignores `.zh.cn.md` mirrors.
3. Package policy controls ordered sections, document blocks, editable files, locked files, and runtime-ignored files.
4. Identity writes are limited by the package policy to `SOUL.md`, `USER.md`, and `EXTENSION.md`, and are validated completely before any write.
5. Every repository documentation Markdown file has a `.zh.cn.md` human mirror.

## Model, Tool, And Transport

1. Provider endpoint, authentication, path, and wire parsing live under `src/model/protocol`. Every provider maps to one protocol and endpoint.
2. Tools owns Ask, Filesystem, Shell, Execute, and Task. There is no standalone Confirm tool.
3. Task validates delegation descriptions only. Synapse dispatches persistent Agents and awaits Complete summaries.
4. Transport reports input through awaited callbacks and never imports Synapse.
5. IPC is an eight-byte big-endian JSON body length followed by UTF-8 JSON. Socket code handles chunking, coalescing, split UTF-8, malformed packets, and backpressure.

## Health Gate

`bun run check` is the minimum gate and includes AST checks for failure rules, IOC-only construction, JSDoc, method limits, private Turn, and forbidden Session types. Run relevant tests for focused changes. Run `bun test` and `bun run build:binary` before completing a kernel-wide refactor.

Run `bun run test:live` before completing changes to cognition prompts, provider protocols, neural routing, concrete tools, or the Web/IPC boundary when the configured real-model credential is available. The live suite must use disposable files and must not modify durable identity or user logs.

## Worktree Policy

The worktree may be dirty. Do not revert user changes. Ignore unrelated changes unless they block the task.

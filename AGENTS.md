# AGENTS.md - Flyflor Project Rules

Flyflor uses the project-local `.agents/skills/oop-code-redlines/SKILL.md` skill as its default engineering discipline. Load and follow that file before writing, reviewing, refactoring, debugging, testing, or documenting code in this repository. Flyflor-specific rules below take precedence over the skill when they conflict.

## Code Rules

1. Code is the source of truth. Documentation describes implemented behavior or clearly marks planned work.
2. Runtime code is OOP-first. Behavior belongs on classes extending the correct base: `FModule`, `FService`, `FComponent`, `FAgent`, `FCortex`, or `FTool`.
3. Exported functions are allowed only at explicit boundaries: decorators, bootstrap, scripts, protocol adapters, and low-level framework helpers.
4. Method bodies have a 300-line soft limit and a 500-line hard limit. Extract only real object actions, reusable behavior, isolated side effects, or actual complexity.
5. Every directory name is one lowercase English word. The only top-level source roots are `app`, `core`, `config`, `prompt`, `model`, `agent`, `neural`, `tool`, and `transport`.
6. File names describe local roles, such as `index.ts`, `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, `container.ts`, `abstracts.ts`, `socket.ts`, `packet.ts`, `module.ts`, `entity.ts`, and `*.test.ts`.
7. `index.ts` is a barrel only. It must not own behavior or side effects.
8. Do not introduce generic `utils`, `manager`, `parser`, `compiler`, or `diagnostic` files without a durable object boundary.
9. Use `@/*` imports across source domains. Prefer relative imports inside one directory boundary.

## Dependency Rules

1. Business dependencies flow `app -> neural -> agent -> model/tool`.
2. `neural` may depend on `transport`; `transport` must never import `neural`.
3. `agent` must not import `neural`. Signals crossing that boundary use the agent bus contract and stable action strings.
4. `model` and `tool` must not depend on each other. Agent orchestration composes their structural contracts.
5. `core`, `config`, and `prompt` are shared infrastructure; do not use them to bypass business ownership.

## Runtime Boundaries

1. `reflect-metadata` must load before decorated classes.
2. Only IOC may construct application classes. Use `useContainer().getAsync()` or `useContainer().create()` outside `src/core/ioc/container.ts`.
3. Injected class dependencies must be runtime imports, not type-only imports.
4. Decorators are limited to `Module`, `Provide`, `Singleton`, `Inject`, `Scope`, `Init`, `Config`, and `Prompt`.
5. `Turn` is the only conversational entity. `Memory` is its only owner and must mark an active Turn failed at an error boundary.
6. Brain owns cognition. Callosum perceives once per input. Synapse owns input, coordination, interaction, and the Agent pool.
7. Model endpoint, authentication, path, and wire parsing are protocol conventions under `src/model/protocol`; configuration must not recreate a protocol registry.
8. `Tools` explicitly owns concrete tools. Each tool owns its schema, cwd convention, prompt description, and approval decision. Do not add a standalone confirm tool.
9. Transport reports input through callbacks or packet contracts and must not import Synapse.
10. Configuration belongs in `.config/config.jsonc`; secrets belong in environment variables.
11. IPC packets use an 8-byte big-endian JSON body length followed by a UTF-8 JSON body. Socket code must tolerate chunking, coalescing, malformed packets, split UTF-8 bytes, and backpressure.

## Prompt Rules

1. Prompt loading follows directory and filename conventions. Runtime loads canonical English `.md` files and ignores `.zh.cn.md` mirrors.
2. Identity writes are limited in code to `SOUL.md`, `USER.md`, and `EXTENSION.md`. Do not reintroduce a generic XML write policy.
3. Every repository documentation `.md` file must have a `.zh.cn.md` human mirror, including root files, `docs/**/*.md`, and `prompts/**/*.md`.
4. README and docs are implementation references, not additional rule systems.

## Health Gate

`bun run check` is the minimum health gate. Run relevant `bun test` suites for behavior changes. Run `bun test` and `bun run build:binary` before completing a kernel-wide refactor.

## Worktree Policy

The worktree may be dirty. Do not revert user changes. Ignore unrelated changes unless they block the task.

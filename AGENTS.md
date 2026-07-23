# AGENTS.md - Flyflor Project Rules

Flyflor uses the project-local `.agents/skills/oop-code-redlines/SKILL.md` skill as its default engineering discipline. Load and follow the project-local skill before writing, reviewing, refactoring, debugging, testing, or documenting code in this repository. Do not rely on a global-only copy.

This file contains only Flyflor-specific additions. If the project-local skill and a project rule conflict, the project rule wins for this repository.

## Flyflor Code Rules

1. Code is the source of truth. Documentation describes implemented behavior or clearly marks planned work.
2. Runtime code is OOP-first. Business behavior belongs on classes extending the correct core base class: `FModule`, `FService`, `FComponent`, `FRepo`, `FGuard`, `FSandBox`, `FAgent`, or `FCortex`.
3. Composition-style exported functions are allowed only at explicit boundaries: decorators, factories, bootstrap, scripts, protocol adapters, and low-level framework helpers.
4. Method bodies have a 300-line soft limit and a 500-line hard limit. Do not extract helpers under 500 lines unless the extraction names a real object action, isolates a side effect, enables reuse, or reduces actual complexity.
5. Directory names are semantic nouns. File names are local roles such as `index.ts`, `service.ts`, `types.ts`, `constants.ts`, `decorator.ts`, `factory.ts`, `container.ts`, `abstracts.ts`, `socket.ts`, `module.ts`, `entity.ts`, `repository.ts`, and `*.test.ts`.
6. `index.ts` is a barrel only. It re-exports local module surfaces and must not own behavior.
7. Do not introduce generic `utils`, `manager`, `parser`, `compiler`, or `diagnostic` files unless a real object boundary and sustained size justify that object.
8. Use `@/*` imports for cross-domain source imports. Relative imports are preferred inside the same directory boundary.
9. Instance fields are declared without an initializer and assigned in the constructor. Exemptions: `static` fields, decorator-injected fields (`@Inject()`/`@Config()`/`@Prompt()` style `!: Type` declarations), and function-valued properties.
10. Every public class property/method and every exported interface/type-literal member must carry an EN/ZH bilingual JSDoc (`EN: ... / ZH: ...`). The class-level doc comment sits above the decorators, never between a decorator and the class declaration. `bun run check` enforces rules 9-10.

## Runtime Boundaries

1. `reflect-metadata` must load before decorated classes.
2. Only the IOC container may construct application classes. Do not call `new` for project classes outside `src/core/ioc/container.ts`; use `useContainer().getAsync()` or `useContainer().create()` where a fresh path-bound object is required.
3. Injected class dependencies must be runtime imports, not type-only imports.
4. Decorators and base classes live under `src/core`. New runtime scopes must use decorators plus inheritance, not loose registries or string-only flags.
5. Config belongs in `./.config/config.jsonc`; secrets belong in environment variables.
6. IPC packets use an 8-byte big-endian JSON body length header followed by a UTF-8 JSON body. Socket code must tolerate chunking, packet coalescing, malformed packets, and split UTF-8 bytes.

## Documentation Rules

1. Every repository documentation `.md` file must have a `.zh.cn.md` human mirror. This includes root-level `*.md`, `docs/**/*.md`, and `prompts/**/*.md`.
2. Runtime prompt sources are canonical English `.md` files. `.zh.cn.md` mirrors are human references and must never be read by runtime code.
3. Do not let README, docs, or prompts become second rule systems. Shared engineering style lives in `.agents/skills/oop-code-redlines/SKILL.md`; Flyflor-specific rules live here.

## Health Gate

`bun run check` is the minimum health gate before considering a change healthy. Run relevant `bun test` suites for behavior changes.

## Worktree Policy

The worktree may be dirty. Do not revert user changes. Ignore unrelated changes unless they block the task.

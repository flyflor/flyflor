# Investigation Evidence Loop

## Purpose

Investigation is the read-only evidence loop for Flyflor's coding-first core. The model still owns semantic routing through the turn-decision JSON; the host only validates workspace boundaries, exposes read-only tools, records evidence, and audits what happened.

## Phase 1: Workspace Allowlist

A model-selected `projectPath` or `writeTargetRoot` must never become a tool cwd until a project-owned guard canonicalizes it.

`WorkspaceAllowlistComponent` lives under `src/sandbox` because it is part of the scout/guard boundary, not kernel business logic. It reads `runtime.workspaceRoots` from config. When no roots are configured, the project root is the only allowed root.

Rules:

- Relative roots are resolved under `ConfigService.getProjectRoot()`.
- Absolute roots are accepted only when they equal an allowed root or are descendants of one.
- Parent escapes, invalid paths, and non-allowlisted paths are denied before tool execution.
- Denials emit `workspace.denied` and are recorded in brain audit by the caller's existing event path.

## Later Phases

The full investigation loop will replace host inline inspection with one model-driven read-only loop:

1. `repo_overview` or CodeGraph orientation.
2. Targeted `grep`/`glob`/`read` evidence collection.
3. Evidence records stored as a separate rebuildable ledger, not semantic memory.
4. Optional verification path through approved tools.

Every prompt added for investigation must have both `.md` and `.zh.cn.md` mirrors.

# Development Workflow

## One-line position

Flyflor now develops through a `git worktree + tmux + Codex` coordinator workflow: the main Codex owns global review and canonical history, while child worktrees own narrow slices and return reviewed commits.

## Why this exists

The project boundary is already clear enough that parallel work is useful, but Flyflor still needs one explicit cognitive owner for:

- architecture wording
- boundary review
- merge discipline
- final validation
- handoff for the next session

So the workflow is intentionally asymmetric:

- main worktree = coordinator
- child worktrees = owned slices

## Roles

### Main Codex

The main Codex owns:

- task split
- worktree creation
- tmux session orchestration
- final review
- selective merge
- mainline `LOGS.md`
- final validation and commit

The main worktree is the only branch that should declare the canonical merged project history.

### Child worktrees

Each child worktree owns one narrow slice:

- one coherent doc surface, or
- one coherent code surface, or
- one bounded implementation task

Child worktrees should not redefine global project history. They return focused commits for review.

## Required control files per worktree

Each worktree must carry its own local control files:

- `TODO.md`
- `AGENTS.md`
- `LOGS.md`

And each Markdown file must keep its `.zh.cn.md` companion.

Local control-file rules:

- `TODO.md`: only add items or change status markers; do not delete history.
- `AGENTS.md`: append-only when new local rules are truly needed.
- `LOGS.md`: append-only.

These files are primarily local worktree records. Mainline review should merge owned implementation/docs first, and only merge child control-file history when that is explicitly desired.

## Ownership rules

Before a worktree starts, define:

1. branch name
2. owned files
3. validation command
4. handoff condition

Example:

- branch: `wt/docs-scope-ask`
- owned files:
  - `docs/runtime.turn.md`
  - `docs/runtime.turn.zh.cn.md`
  - `docs/blackboard.md`
  - `docs/blackboard.zh.cn.md`
- validation: `bun test tests/docs.references.test.ts`
- handoff: committed branch, TODO marked ready, LOGS appended

No child worktree should drift outside its owned file set without explicit coordinator approval.

## tmux orchestration

The expected pattern is:

1. coordinator prepares prompts and ownership boundaries
2. coordinator starts one tmux window per child Codex
3. child Codex instances work only inside their own worktree
4. coordinator monitors progress and trims any overreach
5. child branches commit locally
6. coordinator reviews and selectively merges back to main

tmux is here to make parallel work observable. It is not a license to let child sessions silently redefine repository-wide rules.

## Review and merge rules

Mainline merge discipline is strict:

1. review child diff by owned files
2. reject or trim overreach
3. merge only the intended files
4. run mainline validation again
5. write the final coordinator log entry

If the main worktree is on a managed branch such as `gitbutler/workspace`, switch to a normal branch before the final commit. Do not bypass hooks destructively.

## New session handoff

A fresh session should read in this order:

1. `docs/boundaries.md`
2. `docs/architecture.md`
3. `docs/development.workflow.md`
4. `docs/README.md`
5. root `TODO.md`
6. root `LOGS.md`

Then inspect the current branch and worktrees:

```bash
git status --short --branch
git worktree list
```

If continuing a child worktree, also read that worktree's local:

- `TODO.md`
- `AGENTS.md`
- `LOGS.md`

## Current snapshot

Snapshot date: `2026-05-22`

Reviewed document worktrees:

- `wt/docs-memory-philosophy`
  - owned docs:
    - `docs/memory.system.md`
    - `docs/memory.system.zh.cn.md`
    - `docs/crystal.reflection.md`
    - `docs/crystal.reflection.zh.cn.md`
  - reviewed commit: `a0aa877`
- `wt/docs-scope-ask`
  - owned docs:
    - `docs/runtime.turn.md`
    - `docs/runtime.turn.zh.cn.md`
    - `docs/blackboard.md`
    - `docs/blackboard.zh.cn.md`
  - reviewed commit: `f557924`
- `wt/docs-protocol-events`
  - owned docs:
    - `docs/control.protocol.md`
    - `docs/control.protocol.zh.cn.md`
    - `docs/runtime.events.md`
    - `docs/runtime.events.zh.cn.md`
  - reviewed commit: `6a6d0c2`

Coordinator merge commit on mainline:

- `4c21957` — reviewed worktree architecture refinements merged to `main-codex-docs`

## Seal handoff snapshot

Seal date: `2026-05-22`

Current pushed branch set to resume from a new environment:

- coordinator: `main-codex-docs`
- baseline mirror: `master`
- child branches:
  - `wt/docs-memory-philosophy`
  - `wt/docs-scope-ask`
  - `wt/docs-protocol-events`

Current local worktree paths:

- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-memory-philosophy`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-scope-ask`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-protocol-events`

Seal-critical implementation state now carried by mainline:

- legacy `brain.db` compatibility upgrades add missing `memory_events` columns before owner/index DDL runs
- archive locator import tolerates older shards that do not yet carry `context_forks`, `task_plans`, `scopes`, or renamed replay tables
- recovery smoke isolates its temp home and sets explicit `FLYFLOR_HOME`, so worktree-local repo config no longer contaminates warmup recovery

Most recent coordinator validation:

- `bun run kernel:seal`
- deterministic suite: `821 pass`, `0 fail`
- live checks passed in the same workspace:
  - `bun run test:live`
  - `bun run smoke:agent:live`
- Rust-shell bootstrap guard now also lives in deterministic smoke:
  - `bun run smoke:gateway:control`

## Practical rule

When in doubt:

- narrow the ownership
- commit locally
- review from main
- merge selectively

Flyflor wants parallel execution, but it still wants one explicit mind holding the current merged truth.

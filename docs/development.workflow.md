# Development Workflow

## One-line position

Flyflor now develops through a `git worktree + tmux + Codex` coordinator workflow: the main Codex owns global review and canonical history, while child worktrees own narrow slices and return reviewed commits.

Current operating mode: this is no longer just a seal-maintenance loop. The active target is the full intelligent-lifeform kernel refactor, so coordinator continuity and branch hygiene are now first-class repo concerns.

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
- every stop/pause handoff document update
- full push of changed branches before yielding the repository

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

Restore command:

```bash
bun run kernel:tmux
bun run kernel:tmux -- --launch-codex
```

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

Before the coordinator stops for any reason, it must update:

1. root `TODO.md`
2. root `LOGS.md`
3. `docs/development.workflow.md`
4. `docs/development.workflow.zh.cn.md`
5. push every changed branch/worktree branch that should survive a machine/session switch

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

Active code worktrees:

- `wt/kernel-context-memory`
  - owned files:
    - `src/cognitive/hippocampus/memory/**`
    - `src/entities/memory/**`
    - `src/agent/context/**`
    - related tests and local control files
  - validation:
    - `bun run check`
    - targeted memory/context tests
- `wt/kernel-scope-crystal-ask`
  - owned files:
    - `src/cognitive/hippocampus/scope/**`
    - `src/cognitive/hippocampus/ask/**`
    - `src/cognitive/crystal/**`
    - related tests and local control files
  - validation:
    - `bun run check`
    - targeted ask/scope/crystal tests
- `wt/kernel-runtime-executive-ws`
  - owned files:
    - `src/agent/runtime/**`
    - `src/agent/gateway/**`
    - `src/executive/**`
    - related scripts/tests/docs and local control files
  - validation:
    - `bun run check`
    - targeted runtime/gateway/executive tests

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
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-context-memory`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-scope-crystal-ask`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-runtime-executive-ws`

Current tmux restore surface:

- script: `scripts/tmux.worktree.dev.sh`
- package entry: `bun run kernel:tmux`
- default session: `flyflor-kernel`
- windows:
  - `main`
  - `context`
  - `scope`
  - `runtime`

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

Next scaling rule:

- when the mainline task stops being a narrow fix and becomes a multi-slice refactor again, create or refresh code worktrees and run child Codex sessions under tmux instead of stretching one session indefinitely

## 2026-05-22 Integration Wave 1

Coordinator-reviewed code slices now landed on mainline:

- `wt/kernel-context-memory`
  - landed:
    - live brain shard rollover now exports the current month into archive and recreates a fresh live shard for the next month
    - graph recall accounting updates recall counters on memory nodes and gems
- `wt/kernel-scope-crystal-ask`
  - landed:
    - crystal recall returns structured evidence metadata
    - crystal memory exposes explicit gem forgetting without deleting candidate/atom provenance
    - ask parsing now rejects `freeform=false` asks with no structured choice surface
    - scope scaffold persists trigger metadata into `.flyflor/scope.json`
- `wt/kernel-runtime-executive-ws`
  - landed:
    - `/ws` control turns reuse client `requestId` as runtime correlation
    - ws docs now describe the explicit ask pause/resume loop contract
    - deterministic smokes cover ask-loop closure and thin-client history replay

Resume guidance for a new environment after this integration wave:

1. sync/fetch all branches
2. restore `main-codex-docs`
3. run `bun run kernel:tmux`
4. inspect `git status --short --branch`
5. confirm whether the next pass should continue on the existing code worktrees or create a fresh split from the new mainline snapshot

## Practical rule

When in doubt:

- narrow the ownership
- commit locally
- review from main
- merge selectively

Flyflor wants parallel execution, but it still wants one explicit mind holding the current merged truth.

## 2026-05-22 Integration Wave 2 Closeout

Coordinator-maintained mainline contract after the second integration wave:

- HTTP Gateway remains pruned to `/ws` and `/health`.
- WS `gateway.status.get` remains the structured status lane.
- `clientCount` is documented and tested as live WS peer count, not static channel count.
- The docs guard now keeps `clientCount` visible in the Rust/thin-client WS handoff.

Validation for this closeout:

- `bun test tests/docs.references.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts`

## 2026-05-22 Wave 2 Tmux Layout

Fresh wave2 worktrees are based on `main-codex-docs@c6d963f` and intentionally do not reuse the previous kernel worktrees as execution baselines.

Restore command:

```bash
bun run kernel:tmux -- --wave2
bun run kernel:tmux -- --wave2 --launch-codex
```

Active wave2 branches:

- `wt/wave2-memory-seal`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-memory-seal`
  - owned surface: memory/context stores, decay, forgetting, vector recall, related tests
- `wt/wave2-runtime-executive`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-runtime-executive`
  - owned surface: runtime, gateway WS/control, executive capability execution, related tests/docs
- `wt/wave2-scope-crystal`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-scope-crystal`
  - owned surface: ask, scope, codename promotion, crystal consolidation/forgetting, related tests

Coordinator probe before launching wave2:

- `bun test tests/provider.readiness.test.ts tests/ask.cap.runtime.test.ts`

## 2026-05-22 Wave 2 Reviewed Integration

The coordinator reviewed and staged the wave2 child output into `main-codex-docs` without reopening the HTTP Gateway surface.

Reviewed child commits:

- `wt/wave2-memory-seal`
  - deterministic spreading activation ordering
  - deterministic graph recall ordering
  - recall cache and contradiction audit paths honor the injected clock
- `wt/wave2-runtime-executive`
  - gateway control smoke now uses the real event component and runtime bus
  - WS subscribers assert `executive.loop.paused` and `executive.loop.resumed` as delivered `event.publish` envelopes
- `wt/wave2-scope-crystal`
  - nested non-freeform asks require their own structured choices
  - codename promotion writes an explicit `Scope` ledger row
  - crystal gems preserve source candidate ids and consolidation evidence metadata

Coordinator-owned merge rules for this wave:

- keep child implementation/tests, but write canonical TODO/LOGS/workflow history from the main worktree
- keep HTTP Gateway limited to `/ws` and `/health`
- keep WS `gateway.status.get` as the status lane
- keep `brain.db` as ledger/query/replay/audit state, not a prompt assembly container

Validation already run on the staged mainline snapshot:

- `bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`
- `bun run smoke:gateway:control`
- `bun test tests/executive.tool.runtime.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/runtime.executive.boundaries.test.ts`
- `bun test tests/ask.parse.test.ts tests/codename.promote.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts`
- `bun run docs:check`

Final closeout before yielding:

1. run `bun run check`
2. run `bun run build:binary`
3. commit and push `main-codex-docs`
4. leave `flyflor-wave2` restorable through `bun run kernel:tmux -- --wave2`

## 2026-05-22 Wave 3 Tmux Layout

Wave3 is additive. Do not delete old worktrees after review; older branches remain as execution history and recovery anchors.

Fresh wave3 worktrees are based on `main-codex-docs@281108e`.

Restore command:

```bash
bun run kernel:tmux -- --wave3
bun run kernel:tmux -- --wave3 --launch-codex
```

Active wave3 branches:

- `wt/wave3-memory-lifecycle`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-memory-lifecycle`
  - owned surface: memory lifecycle, `brain.db` ledger/query/replay/audit behavior, decay, hot memory, dream, recall, archive behavior, related tests
- `wt/wave3-runtime-capability`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-runtime-capability`
  - owned surface: runtime, gateway WS/control, executive capability execution, sandbox/trust visibility, related scripts/tests/docs
- `wt/wave3-scope-constitution`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
  - owned surface: scope scaffold constitution files, ask/scope/codename boundaries, `templates/projects/**`, related tests

Coordinator constraints for wave3:

- all old worktrees stay in place
- all changed child branches must be committed and pushed before yield
- child branches update local TODO/LOGS, but canonical project history is written by main Codex on `main-codex-docs`
- HTTP Gateway remains `/ws` and `/health` only
- `brain.db` remains ledger/query/replay/audit state and is not treated as prompt assembly context
- Bun binary compileability remains a hard gate

## 2026-05-22 Wave 3 Scope Constitution Review

`wt/wave3-scope-constitution` has been reviewed into `main-codex-docs`.

Mainline now expects scope scaffolds to write the full bilingual constitution set:

- `AGENTS.md` / `AGENTS.zh.cn.md`
- `TODO.md` / `TODO.zh.cn.md`
- `LOGS.md` / `LOGS.zh.cn.md`
- `README.md` / `README.zh.cn.md`
- `project.memory.md` / `project.memory.zh.cn.md`

The rule is no-overwrite idempotency: an existing scope file is skipped, never regenerated over local scope state.

Validation:

- `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

## 2026-05-22 Wave 3 Cleanup State

Wave3 closeout state:

- `wt/wave3-scope-constitution`
  - implementation reviewed and merged to `main-codex-docs`
  - branch pushed and clean
- `wt/wave3-memory-lifecycle`
  - validation-only handoff notes pushed
  - no implementation merged
  - branch clean
- `wt/wave3-runtime-capability`
  - exploration notes pushed
  - incomplete runtime/protocol prototype discarded after failing `bun run check`
  - no implementation merged
  - branch clean

All active wave3 child Codex processes were stopped before handoff. The `flyflor-wave3` tmux layout remains as a restorable shell layout, not an active child-agent run.

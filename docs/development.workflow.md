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

- `TODO.md`: task list and work status. Child Codex may only add entries or change status markers; it must not delete, rewrite, or compress history.
- `AGENTS.md`: local constitution and red lines. Child Codex may only append stricter local rules; it must not weaken or remove inherited repository rules.
- `LOGS.md`: historical change log and reason list. Child Codex must append every meaningful change with reason and verification; it must not delete or rewrite prior log entries.

These files are not optional notes; they are part of the parallel-development protocol. A child worktree is not ready for review unless its local `TODO.md`, `AGENTS.md`, and `LOGS.md` reflect the current task status and handoff state.

These files are primarily local worktree records. Mainline review should merge owned implementation/docs first, and only merge child control-file history when that is explicitly desired. If a child control file contains useful canonical knowledge, the main Codex summarizes it into the root `TODO.md`, root `LOGS.md`, or `docs/development.workflow*.md` instead of blindly merging noisy local history.

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

1. confirm the child worktree has a local commit and clean status
2. inspect the child `TODO.md`, `AGENTS.md`, and `LOGS.md` for task state, red-line changes, reasons, and verification
3. review child diff by owned files
4. reject or trim overreach
5. merge only the intended files
6. run mainline validation again
7. write the final coordinator log entry

No child work is merged directly because it exists. Every change passes through main Codex review. If a child branch is partially useful, the coordinator cherry-picks or manually ports only the approved files and records the rejection reason for the rest.

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
    - `src/socket/**`
    - `src/executive/**`
    - related scripts/tests/docs and local control files
  - validation:
    - `bun run check`
    - targeted runtime/socket/executive tests

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

- latest full deterministic suite: `838 pass`, `0 fail`
- `bun run docs:check`
- `bun run check`
- `bun run test`
- `bun run build:binary`
- `git diff --check`
- socket recovery smoke confirmed primary `socket` startup:
  - `bun run scripts/working.memory.recovery.smoke.ts`

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

- HTTP socket remains pruned to `/ws` and `/health`.
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
  - owned surface: runtime, socket WS/control, executive capability execution, related tests/docs
- `wt/wave2-scope-crystal`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-scope-crystal`
  - owned surface: ask, scope, codename promotion, crystal consolidation/forgetting, related tests

Coordinator probe before launching wave2:

- `bun test tests/provider.readiness.test.ts tests/ask.cap.runtime.test.ts`

## 2026-05-22 Wave 2 Reviewed Integration

The coordinator reviewed and staged the wave2 child output into `main-codex-docs` without reopening the HTTP socket surface.

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
- keep HTTP socket limited to `/ws` and `/health`
- keep WS `gateway.status.get` as the status lane
- keep `brain.db` as ledger/query/replay/audit state, not a prompt assembly container

Validation already run on the staged mainline snapshot:

- `bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`
- `bun run smoke:socket:control`
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
  - owned surface: runtime, socket WS/control, executive capability execution, sandbox/trust visibility, related scripts/tests/docs
- `wt/wave3-scope-constitution`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
  - owned surface: scope scaffold constitution files, ask/scope/codename boundaries, `templates/projects/**`, related tests

Coordinator constraints for wave3:

- all old worktrees stay in place
- all changed child branches must be committed and pushed before yield
- child branches update local TODO/LOGS, but canonical project history is written by main Codex on `main-codex-docs`
- HTTP socket remains `/ws` and `/health` only
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

## 2026-05-22 Wave 4 Runtime Capability Layout

Wave4 targets one P0: successful runtime capability execution must become observable end to end without widening the HTTP socket surface.

Restore command:

```bash
bun run kernel:tmux -- --wave4
bun run kernel:tmux -- --wave4 --launch-codex
```

Active wave4 branches:

- `wt/wave4-runtime-smoke`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-smoke`
  - owned surface: gateway control smoke and WS/control tests proving successful approved capability execution is visible
- `wt/wave4-runtime-metadata`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-metadata`
  - owned surface: Runtime/Executive typed metadata for successful capability execution
- `wt/wave4-runtime-history`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-history`
  - owned surface: WS history snapshot mapping of existing structured runtime metadata

Coordinator constraints:

- no `/channels`
- no private WS control message type
- no broad protocol type migration unless a failing test forces it
- no semantic character matching
- failed prototypes are discarded before commit, with LOGS/TODO notes only

Launch state:

- coordinator commit: `90cecbb`
- branches pushed: yes
- tmux session: `flyflor-wave4` is retained as a restorable shell layout
- windows: `runtime-smoke`, `runtime-metadata`, `runtime-history`
- review policy: main Codex accepts only committed, validated, narrow child slices; canonical TODO/LOGS/workflow updates remain on `main-codex-docs`

Review state:

- `wt/wave4-runtime-metadata` commit `8eb7444` reviewed and integrated as implementation/test surface only.
- `wt/wave4-runtime-history` commit `7702efe` reviewed and integrated with an additional mainline execution replay projection from structured ledger provenance.
- `wt/wave4-runtime-smoke` commit `53342ee` reviewed and integrated after replacing the new capability-history success check with structured `executiveToolExecutions` replay metadata.
- HTTP socket remains `/ws` and `/health`; `/channels` remains removed.
- `history.list` remains ledger/query/replay/audit only and is not a prompt assembly or session restore path.
- Active child Codex processes were stopped after integration; `flyflor-wave4` remains only as a restorable shell layout.

## 2026-05-22 Socket Wire Closure Layout

This wave moves the active vascular owner to `src/socket` while keeping `flyflor.ws.v1` wire compatibility stable.

Active socket-wire worktrees:

- `codex/socket-core`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.core`
  - owned surface: `src/socket` core migration review only after main takeover
- `codex/socket-wire-openapi`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.openapi`
  - owned surface: OpenAPI/Apifox contract review only after main takeover
- `codex/life-constitution-docs`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/life.constitution.docs`
  - owned surface: constitution/docs review only after main takeover
- `codex/socket-wire-tests`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.tests`
  - owned surface: tests/reference review only after main takeover
- `codex/ledger-context-boundary`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/ledger.context.boundary`
  - owned surface: ledger/context boundary review only after main takeover

Coordinator constraints:

- keep `/ws` and `/health`; do not restore `/channels`
- keep `flyflor.ws.v1`, `flyflor.event.v1`, `gateway.message.send`, `gateway.status.get`, and `gateway.status.snapshot`
- treat `gateway.*` as v1 wire compatibility names only
- keep `brain.db` as ledger/query/replay/audit/detail only
- context assembly remains current input + MemoryComponent + CrystalComponent + explicit Scope/Fork + Executive visible capability surface

Review state:

- main Codex redirected child agents to review mode after no early worktree output appeared
- active implementation was completed in the coordinator worktree to avoid stale parallel edits
- Apifox contract lives at `docs/openapi/flyflor.socket.openapi.json`
- final validation passed and the reviewed commits were pushed through `main-codex-docs`

## 2026-05-22 Current Coordinator Snapshot

- current branch: `main-codex-docs`
- latest reviewed commit: `dee560a`
- active socket owner: `src/socket`
- HTTP surface: `/health` and `/ws`; `/channels` remains removed
- Apifox contract: `docs/openapi/flyflor.socket.openapi.json`
- latest full deterministic suite: `838 pass`, `0 fail`
- no active child Codex process is required for the socket wire closure; existing tmux/worktree layouts are preserved as additive history and restore points

## 2026-05-22 Seal Wave Real-Model Layout

This wave is Bun-only. Rust is out of this repository and will be developed separately.

Coordinator:

- branch: `codex/seal-coordinator`
- path: `/Users/yi./Desktop/yi/flyflors/flyflor`
- owner: main Codex review, merge, validation, TODO/LOGS/workflow, final cleanup

Worktrees:

- `codex/docs-alignment-control` at `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
  - docs alignment, remove active Rust-in-this-repo planning, lock real-model seal wave wording
- `codex/apifox-openapi-scenarios` at `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
  - OpenAPI/Apifox scenario contract and drift guards
- `codex/socket-live-model-scenarios` at `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
  - real configured-provider socket scenario runner and `smoke:socket:live`
- `codex/prompt-optimization-seal` at `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
  - runtime prompt optimization with `.zh.cn.md` companions
- `codex/db-context-guard` at `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
  - cautious DB/context guard or migration only when real scenario gaps require it
- `codex/zero-character-audit` at `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
  - zero character matching audit and guard tests
- `codex/release-binary-seal` at `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
  - release/install/binary/docker seal

Merge order: docs -> OpenAPI -> prompt -> real-model socket -> DB/context guard -> zero-character audit -> release/binary.

Hard constraints:

- no `/channels`
- no wire v2 and no v1 wire string changes
- no Rust implementation or Rust planning as active repository work
- default tests stay deterministic/offline; real-model validation lives in live/smoke gates
- prompt edits must keep canonical `.md` and `.zh.cn.md` in sync
- DB/context changes are allowed only with compatibility tests and explicit boundary notes
- no business semantic character matching

## 2026-05-22 Socket/OpenAPI-Only Reallocation

The active round is now narrowed to the socket layer and OpenAPI/Apifox scenario surface only. Broader docs, prompt, DB/context, zero-character, release, binary, Rust, and external adapter work stays paused for this round unless the user reopens that scope.

Coordinator:

- branch: `codex/seal-coordinator`
- path: `/Users/yi./Desktop/yi/flyflors/flyflor`
- current pushed base: `e5102a5`
- owner: review, merge, validation, TODO/LOGS/workflow, and cleanup

Merged baseline:

- `codex/apifox-openapi-scenarios`
  - commit: `a67ee30`
  - result: Apifox-importable socket contract and scenario docs
- `codex/socket-live-model-scenarios`
  - commit: `fd99d9e`
  - result: configured-provider `smoke:socket:live` runner

Paused but preserved:

- `codex/docs-alignment-control`
- `codex/prompt-optimization-seal`
- `codex/db-context-guard`
- `codex/zero-character-audit`
- `codex/release-binary-seal`

New socket-only worktrees:

- `codex/socket-runtime-wire-polish` at `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish`
  - owned surface: `src/socket/**`, `src/protocol/control/**`, socket smoke/runtime tests
  - task: find and close small runtime wire mismatches without renaming v1 wire strings
- `codex/apifox-openapi-drift-guard` at `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard`
  - owned surface: `docs/openapi/**`, `docs/ws.doc*`, `docs/control.protocol*`, docs reference tests
  - task: make the Apifox contract harder to drift from runtime truth
- `codex/socket-live-coverage` at `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage`
  - owned surface: `scripts/socket.live.scenario.ts`, live tests, package smoke script docs
  - task: expand real configured-provider socket scenario coverage without moving offline tests online

Hard constraints:

- `/channels` must not return
- keep `flyflor.ws.v1`, `flyflor.event.v1`, and `gateway.*` wire-v1 names stable
- WebSocket is the current transport under `src/socket`; it is not the architecture identity
- `history.list` remains ledger query/replay/audit, not context assembly
- no new external adapter, Rust, prompt, DB, release, or binary work in this round

Required validation before merge:

- `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`
- `bun test tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`
- `bun run docs:check`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`
- `bun run check`
- `git diff --check`

## 2026-05-22 Scope Vector Seal Wave

Current coordinator:

- branch: `codex/seal-coordinator`
- path: `/Users/yi./Desktop/yi/flyflors/flyflor`
- tmux session: `flyflor-seal`
- coordinator role: review, merge, validation, canonical TODO/LOGS/workflow, and final cleanup

Active tmux/worktree lanes:

- `docs` -> `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
- `openapi-scenarios` -> `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
- `openapi-drift` -> `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard`
- `socket-runtime` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish`
- `socket-live` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
- `socket-coverage` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage`
- `prompt` -> `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
- `db-context` -> `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
- `zero-char` -> `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
- `release` -> `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
- `scope-vector-core` -> `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`
- `scope-vector-tests` -> `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests`

Scope Vector owner contract:

- `ScopeVectorComponent` owns scope-local SQLite indexes: default runtime storage is `<scope.projectDir>/.flyflor/scope.db`; injected `dbFile` is reserved for tests or explicit migration tooling.
- `scope.db` stores Scope Vector nodes, tree nodes, scope hot memory, association terms, and graph edges. It is a context/index plane, not the life ledger.
- Scope Vector owns deterministic vector encoding and bounded hot-subtree recall, similar in spirit to the Crystal vector index and OpenHuman-style memory-tree folding.
- Scope is permanent; this component does not implement forgetting or decay over Scope identity.
- The hot cache is only a performance layer and may be rebuilt from SQLite.
- `brain.db` remains ledger/query/replay/audit and is never treated as prompt transcript assembly or Scope hot-memory storage.
- Context assembly remains current input + MemoryComponent + CrystalComponent + explicit Scope/Fork + Executive visible capability surface.
- No semantic `includes`, regex, keyword lists, or punctuation heuristics may drive Scope recall or promotion.

Current completed reports:

- socket runtime wire: no changes needed; focused socket/control tests passed.
- OpenAPI/Apifox scenarios: `docs/openapi/**` polished; wire strings, DB schema, and context assembly unchanged.
- prompt optimization: prompt `.md` / `.zh.cn.md` pairs updated in its lane and validated.
- DB/context guard: test-only fixes; DB schema and context assembly unchanged.
- socket coverage: test-only socket regression coverage.
- release/binary: binary/install/docker-dev/release-assets/socket-service checks passed; `smoke:release` is blocked by Docker daemon availability.

Merge rules for this wave:

- main Codex may keep the coordinator Scope Vector baseline as the canonical implementation if child Scope Vector work returns as review evidence only.
- merge test-only lanes before broad prompt/docs lanes when conflicts are low.
- never merge a child branch that silently changes v1 wire strings, DB schema, context assembly, or Scope forgetting semantics.
- after each merge, run focused validation for the touched surface and `git diff --check`.
- before cleanup, confirm `tmux list-windows -t flyflor-seal` and `git worktree list --porcelain` match the recorded active lanes.

Closeout review:

- all recorded tmux/worktree lanes were launched as real Codex workers and returned to shell
- accepted into coordinator:
  - `socket-runtime-wire-polish`: internal log scope now says `socket.control`; no wire string changed
  - `socket-live-coverage`: successful `/ws` upgrade and correlated `turn.delta` / `turn.final` guards
  - `apifox-openapi-drift-guard`: schema enum drift checks and runtime-reader parsing of OpenAPI examples
  - `zero-character-audit`: expanded semantic-path scan over blackboard, worker, context, full memory, scope, and Executive
- kept as review evidence, not merged:
  - `scope-vector-core`: alternate `src/entities/scope` split conflicts with the coordinator canonical `src/cognitive/hippocampus/scope/vector` owner
  - `scope-vector-tests`: skipped/proposal tests duplicate the canonical Scope Vector coverage
  - `socket-live-model-scenarios`: provider-not-ready must remain fail-fast, not an `ok: false` report
  - broad docs Rust wording moves that would create directory churn outside the Bun-kernel focus

Fresh-session handoff target:

- the final handoff branch is `master`
- `codex/seal-coordinator` is only the staging/coordinator branch for this wave
- coordinator snapshot commit: `811fba1`
- current worktree has been switched back to `master` and fast-forwarded to the seal snapshot
- before ending this session, push `master` and leave the worktree on `master`

## 2026-05-22 Kernel V2 Clean Slate

The previous seal and wave worktrees have been retired. The active baseline is now `master`, with old `wt/*`, `codex/*`, `main-codex-docs`, and GitButler workspace branches removed locally. Remote development branches were pruned/deleted so `origin/master` is the shared baseline for the next wave.

Main Codex role for Kernel V2:

- own architecture guardrails, merge review, canonical TODO/LOGS/workflow, and final validation
- avoid large feature ownership unless a small critical patch is needed
- reject child work that changes v1 wire strings, DB/context assembly, scope/fork continuity, sandbox/trust policy, or prompt templates outside its owned surface
- before any pause, update root `TODO.md`, root `LOGS.md`, this file, the `.zh.cn.md` companion, and push branches that should survive

New worktree allocation:

- `wt/kernel-scope-memory` at `../flyflor-wt-kernel-scope-memory`
  - owned surface: `src/cognitive/hippocampus/memory/**`, `src/cognitive/hippocampus/scope/**`, `src/agent/context/**`, `src/entities/memory/**`, related tests
  - mission: close Scope/Memory/Context plane, including scope-local `scope.db`, codename promotion, explicit Scope activation, and hot project memory
  - validation: `bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/scope.scaffolder.test.ts tests/memory.brain.wire.test.ts tests/brain.store.test.ts tests/brain.archive.test.ts tests/local.working.store.test.ts`; `bun run check`; `git diff --check`
- `wt/kernel-fork-ask-crystal` at `../flyflor-wt-kernel-fork-ask-crystal`
  - owned surface: `src/cognitive/hippocampus/ask/**`, `src/cognitive/hippocampus/continuation/**`, `src/cognitive/crystal/**`, `src/agent/runtime/reflection/**`, related tests
  - mission: make conversation forks branch-like, support LLM-assisted fork merge, trigger ASK on conflicts, preserve unanswered ASK as ghost/continue state, and feed closed loops into Crystal candidates
  - validation: `bun test tests/context.fork.store.test.ts tests/continuation.wire.test.ts tests/continuation.decisions.parse.test.ts tests/ask.parse.test.ts tests/ask.wire.test.ts tests/ask.reply.test.ts tests/ask.cap.runtime.test.ts tests/reflection.worker.test.ts tests/reflection.gem.consolidation.test.ts tests/crystal.local.backend.test.ts`; `bun run check`; `git diff --check`
- `wt/kernel-runtime-executive` at `../flyflor-wt-kernel-runtime-executive`
  - owned surface: `src/agent/runtime/**`, `src/executive/**`, `src/agent/sandbox/**`, `src/agent/mcp/**`, related tests
  - mission: close the nanobot-style runtime path and Executive tool/trust/loop, including structured pause/resume on loop budget, unknown tools, repeated failure, and no-progress conditions
  - validation: `bun test tests/runtime.executive.boundaries.test.ts tests/runtime.mcp.tool.plan.test.ts tests/runtime.perf.test.ts tests/executive.core.test.ts tests/executive.tool.runtime.test.ts tests/executive.manifest.test.ts tests/sandbox.gate.test.ts tests/sandbox.quota.test.ts tests/sandbox.audit.test.ts tests/mcp.schema.validate.test.ts`; `bun run check`; `git diff --check`
- `wt/kernel-socket-protocol` at `../flyflor-wt-kernel-socket-protocol`
  - owned surface: `src/socket/**`, `src/protocol/control/**`, `src/protocol/contracts/**`, `docs/openapi/**`, related tests
  - mission: keep `/ws` + `/health` as the vascular surface, preserve wire-v1 names, expose context/fork/ASK/history/event/capability through structured control/event protocol, and keep OpenAPI/Apifox examples parseable
  - validation: `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts tests/protocol.contracts.test.ts tests/docs.references.test.ts`; `bun run docs:check`; `bun run check`; `git diff --check`
- `wt/kernel-release-seal` at `../flyflor-wt-kernel-release-seal`
  - owned surface: `scripts/**`, install scripts, `docker/**`, release/install/docker tests
  - mission: keep Bun binary, source install, binary install, Docker dev, template release, and release smoke stable without introducing native addons, postinstall, Node.js requirements, or runtime `node_modules` reads
  - validation: `bun run build:binary`; `bun test tests/install.script.test.ts tests/docker.dev.smoke.test.ts tests/docker.binary.build.test.ts tests/release.assets.test.ts`; `bun run smoke:socket:service`; `bun run check`; `git diff --check`
- `wt/docs-contracts-report` at `../flyflor-wt-docs-contracts-report`
  - owned surface: architecture/boundaries/workflow/memory docs, README pairs, and coordinator-approved TODO/LOGS sections
  - mission: write the full project report, directory layering, authorial design philosophy, red lines, Scope/Fork/ASK ghost/Crystal closure model, and the canonical worktree task table
  - validation: `bun run docs:check`; `bun test tests/docs.index.test.ts tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts`; `bun run check`; `git diff --check`

Kernel V2 merge order:

1. `wt/docs-contracts-report` for the canonical contract
2. `wt/kernel-scope-memory` for context/memory foundation
3. `wt/kernel-fork-ask-crystal` for fork, ASK ghost, merge conflict, and crystallization
4. `wt/kernel-runtime-executive` for tool loop execution and pause/resume
5. `wt/kernel-socket-protocol` for external protocol exposure
6. `wt/kernel-release-seal` for final packaging and release verification

Kernel V2 hard design points:

- A conversation may enter a `ContextFork` branch. Users can ask the LLM to merge a fork; conflicts must produce ASK instead of silent overwrite; successful closure may become Crystal evidence.
- An unanswered ASK becomes ghost/pending state. Users can `continue` to resume its scope/fork/loop snapshot instead of losing it.
- `scope.db` is Scope-local vector/tree/hot-memory/association context equipment. `brain.db` remains ledger/query/replay/audit/detail only.
- Runtime context remains current input + Memory + Crystal + explicit Scope/Fork + Executive visible capability surface.
- Socket transport metadata, client ids, conversation keys, users, and threads never become cognitive continuity owners.

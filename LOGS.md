# Flyflor Logs

## 2026-05-21

- Status: open
  Actor: main-codex
  Scope: documentation-architecture-alignment
  Summary: Started the mainline documentation pass to align Flyflor with the "intelligent lifeform kernel" framing, add control-file workflow scaffolding, and prepare document-focused worktrees.
  Reason: The project philosophy, core design, and implementation documents need to describe Flyflor as a lifeform-oriented cognitive kernel instead of a generic agent runtime before multi-worktree development begins.
  Verification: pending

- Status: completed
  Actor: main-codex
  Scope: documentation-architecture-alignment
  Summary: Landed the mainline architecture-anchor document pass, added append-only LOGS scaffolding, and created three sibling document worktrees from the new baseline.
  Reason: The main worktree must own the canonical lifeform framing and initialize parallel document worktrees from a stable reviewed base.
  Verification: `bun run docs:check`; `bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; git commit `ae038bd`

- Status: completed
  Actor: main-codex
  Scope: documentation-architecture-alignment
  Summary: Landed the mainline anchor docs, reviewed the three document worktrees, and merged only their owned lifeform-architecture doc updates back to the coordinator branch.
  Reason: The main worktree owns the canonical project history and must close the worktree split with a reviewed, conflict-free document set.
  Verification: pending

- Status: completed
  Actor: main-codex
  Scope: development-workflow-handoff
  Summary: Added a canonical development workflow doc for `git worktree + tmux + Codex`, linked it from the active indexes, and recorded the reviewed worktree snapshot for future sessions.
  Reason: New sessions need an explicit repository-side handoff for parallel execution, worktree ownership, merge discipline, and current branch status instead of reconstructing it from chat history.
  Verification: pending

- Status: completed
  Actor: main-codex
  Scope: seal-blocker-recovery
  Summary: Closed the remaining seal blockers by upgrading legacy monthly `brain.db` shards before owner-key index creation, guarding archive locator import against older tables, and forcing isolated `FLYFLOR_HOME` recovery smokes so repo worktrees no longer leak prompt/config state into warmup.
  Reason: The repository was already green on docs, check, deterministic tests, and agent smoke; the final release blocker was a narrow recovery/migration gap that prevented `kernel:seal` from completing cleanly for new environments and new sessions.
  Verification: `bun test tests/brain.store.test.ts`; `bun test tests/config.memory.tuning.test.ts`; `bun run smoke:recovery`; `bun run kernel:seal`

- Status: completed
  Actor: main-codex
  Scope: rust-shell-gateway-control-smoke
  Summary: Added a deterministic `/ws` gateway control smoke that exercises the thin-client bootstrap and stream path through the real GatewayModule and RuntimeModule using `server.hello`, `gateway.status.get`, `capability.catalog.get`, `gateway.message.send`, `turn.delta`, and `turn.final`.
  Reason: The next implementation lane is the Rust shell backlog, and the Bun mainline needed an executable guard for the exact control surface that Rust will consume before any external shell rewrite begins.
  Verification: `bun run smoke:gateway:control`

- Status: completed
  Actor: main-codex
  Scope: coordinator-mode-upgrade
  Summary: Upgraded the repository handoff contract from short seal sprints to a long-running coordinated refactor mode whose explicit target is the full intelligent-lifeform kernel, with mandatory workflow/handoff updates and full-branch pushes at every stop.
  Reason: The next stage needs higher throughput than a single-thread linear loop, and new sessions must be able to resume coordination and worktree/tmux execution without reconstructing intent from chat history.
  Verification: repository handoff docs updated on mainline before the next worktree split

- Status: completed
  Actor: main-codex
  Scope: kernel-worktree-bootstrap
  Summary: Added the reproducible `bun run kernel:tmux` restore entrypoint, created the three code worktree branches for context-memory, scope-crystal-ask, and runtime-executive-ws, and updated the handoff docs to reflect the new concurrent kernel-development layout.
  Reason: The next phase is a broad kernel refactor, so new machines and new sessions need a stable way to recreate worktrees, tmux windows, and child-Codex ownership without relying on ephemeral shell state.
  Verification: `bun run kernel:tmux`

- Status: completed
  Actor: main-codex
  Scope: kernel-slice-integration-wave-1
  Summary: Reviewed and integrated the first three code worktree slices into `main-codex-docs`, adding live brain shard rollover hardening, crystal/scope/ask closure work, and a ws thin-client loop smoke plus request-correlation guards.
  Reason: The project needed one reviewed mainline snapshot where memory rollover, crystal recall/forget, ask/scope solidification, and ws loop visibility all coexist for the next long-running kernel pass.
  Verification: `bun test tests/brain.store.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts tests/ask.parse.test.ts tests/scope.scaffolder.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts`; `bun run smoke:gateway:ask-loop`; `bun run smoke:gateway:control`; `bun run check`

- Status: open
  Actor: main-codex
  Scope: gateway-http-surface-prune
  Summary: Planned the active-priority prune of the HTTP `/channels` surface from the minimal Gateway while keeping the WS `gateway.status.get` snapshot lane intact.
  Reason: The current iteration is targeting a smaller Gateway surface and faster closure, so the REST status endpoint is redundant once WS control already exposes structured connection state.
  Verification: pending

- Status: completed
  Actor: main-codex
  Scope: gateway-http-surface-prune
  Summary: Removed the active `/channels` HTTP surface, retired the live gateway.channels docs, and aligned the active docs, tests, and gateway module to keep only `/ws` and `/health` on the HTTP side.
  Reason: The thin Gateway should not duplicate connection snapshot semantics once WS control already carries `gateway.status.get` and `gateway.status.snapshot`.
  Verification: `bun test tests/gateway.module.test.ts tests/todo.status.test.ts tests/docs.references.test.ts`; `bun run docs:check`

- Status: completed
  Actor: main-codex
  Scope: kernel-integration-wave-2
  Summary: Kept the mainline surface pruned to `/ws` and `/health`, recorded the live peer-count status lane, and merged the context-memory clock-driven recall slice back into the coordinator branch.
  Reason: The active gateway should stay thin while still exposing observable hub pressure, and the memory/context slice needed to return to mainline before the next kernel pass.
  Verification: `bun run check`; `bun run docs:check`; `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/brain.store.test.ts tests/brain.archive.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts tests/background.scheduler.test.ts tests/activation.test.ts tests/decay.anti.bloat.project.test.ts tests/dream.worker.test.ts tests/hot.memory.compression.worker.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/docs.references.test.ts`; `bun run build:binary`

- Status: completed
  Actor: main-codex
  Scope: gateway-status-peer-count-contract
  Summary: Pinned `clientCount` in the active WS/control docs as live WS peer pressure and added a docs guard so the Rust/thin-client handoff keeps that field visible.
  Reason: The minimal Gateway no longer exposes HTTP `/channels`, so peer observability must stay explicit on the WS status snapshot without being confused with static channel availability.
  Verification: `bun test tests/docs.references.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts`

- Status: open
  Actor: main-codex
  Scope: kernel-wave2-tmux-orchestration
  Summary: Preserved the previous scope child branch, created fresh wave2 worktrees from `main-codex-docs@c6d963f`, and launched `flyflor-wave2` with memory, runtime, and scope child Codex windows.
  Reason: The next kernel pass needs faster closure without letting child sessions continue on stale pre-merge worktree baselines.
  Verification: `git worktree list`; `tmux list-windows -t flyflor-wave2`; `bun test tests/provider.readiness.test.ts tests/ask.cap.runtime.test.ts`

- Status: completed
  Actor: main-codex
  Scope: kernel-wave2-reviewed-integration
  Summary: Reviewed the three wave2 child branches and staged their owned implementation surfaces into `main-codex-docs`: deterministic memory recall clocks and tie-breakers, WS-published executive loop lifecycle events, explicit codename-to-scope ledger persistence, nested ask validation, and crystal consolidation provenance.
  Reason: The wave2 tmux split produced narrow implementation commits; the coordinator branch needed a single reviewed snapshot that keeps the Gateway surface pruned while advancing memory, runtime, scope, and crystal closure together.
  Verification: `bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`; `bun run smoke:gateway:control`; `bun test tests/executive.tool.runtime.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/runtime.executive.boundaries.test.ts`; `bun test tests/ask.parse.test.ts tests/codename.promote.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts`; `bun run docs:check`

- Status: open
  Actor: main-codex
  Scope: kernel-wave3-tmux-orchestration
  Summary: Added a fresh wave3 tmux/worktree lane from `main-codex-docs@281108e` while preserving all previous kernel and wave2 worktrees.
  Reason: The next development pass needs maximum parallel throughput without losing prior execution history; each new branch starts from the reviewed wave2 mainline snapshot and keeps ownership narrow.
  Verification: `bun run kernel:tmux -- --wave3`; `git worktree list`; `tmux list-windows -t flyflor-wave3`

- Status: completed
  Actor: main-codex
  Scope: wave3-scope-constitution-review
  Summary: Reviewed and integrated the wave3 scope constitution slice so promoted scopes receive the full bilingual AGENTS/TODO/LOGS/README/project.memory constitution file set while preserving idempotent no-overwrite behavior.
  Reason: Scope worktrees need redlines, task state, logs, handoff docs, and local project-memory guidance immediately at scaffold time instead of relying on chat context or later manual repair.
  Verification: `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

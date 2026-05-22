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

- Status: completed
  Actor: main-codex
  Scope: wave3-residual-cleanup
  Summary: Pushed all wave3 child branches, stopped child Codex processes, kept the scope constitution implementation merged, preserved memory/runtime validation notes on their branches, and discarded the incomplete runtime/protocol prototype before it reached mainline.
  Reason: The project rule is additive worktree history with zero dirty tails; failed or incomplete exploration must be recorded without leaving broken code or unpushed local state.
  Verification: `git status --short --branch` across mainline and all wave3 worktrees; `tmux list-windows -t flyflor-wave3`

- Status: open
  Actor: main-codex
  Scope: kernel-wave4-runtime-capability-orchestration
  Summary: Started a wave4 runtime-capability split with smoke, metadata, and history lanes so the remaining P0 can move in parallel without repeating the broad protocol prototype from wave3.
  Reason: Runtime capability E2E observability remains the main closure gap; splitting tests, runtime metadata, and history replay keeps each child branch narrow and reviewable.
  Verification: `git push origin main-codex-docs`; `git push -u origin wt/wave4-runtime-smoke`; `git push -u origin wt/wave4-runtime-metadata`; `git push -u origin wt/wave4-runtime-history`; `bun run kernel:tmux -- --wave4 --launch-codex`

- Status: open
  Actor: main-codex
  Scope: kernel-wave4-child-run
  Summary: Launched `flyflor-wave4` with runtime-smoke, runtime-metadata, and runtime-history child Codex windows from pushed additive worktrees.
  Reason: The user requested maximum parallel throughput while preserving coordinator review, clean worktrees, and no residual tails.
  Verification: `tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`

- Status: completed
  Actor: main-codex
  Scope: kernel-wave4-runtime-capability-review
  Summary: Reviewed and integrated wave4 metadata, history, and smoke slices into `main-codex-docs`, adding live `executiveToolExecutions`, replay-only execution metadata from structured ledger provenance, compact planning replay metadata, and an end-to-end WS smoke for successful approved capability execution.
  Reason: Runtime capability execution needed to be observable through live `turn.final`, subscribed runtime events, and `history.list` replay without widening HTTP Gateway, reintroducing `/channels`, or relying on text-derived history classification.
  Verification: `bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/tui.chat.history.test.ts tests/skill.mcp.test.ts`; `bun run check`; `bun run docs:check`; `git diff --check`; `bun run build:binary`

- Status: completed
  Actor: main-codex
  Scope: kernel-wave4-cleanup
  Summary: Stopped the active wave4 child Codex processes, kept the tmux layout as shell windows, and confirmed mainline plus all wave4 worktrees are clean and pushed.
  Reason: Each parallel development wave must end with no active child processes, no dirty tails, and no unpushed branch state before the next iteration begins.
  Verification: `tmux list-windows -t flyflor-wave4 -F '#I:#W #{pane_current_path} #{pane_current_command}'`; `git status --short --branch` for `main-codex-docs`, `wt/wave4-runtime-smoke`, `wt/wave4-runtime-metadata`, and `wt/wave4-runtime-history`

- Status: completed
  Actor: main-codex
  Scope: socket-wire-closure
  Summary: Moved the active vascular transport owner from `src/agent/gateway` to `src/socket`, introduced `SocketModule` / `SocketControlHub`, preserved `flyflor.ws.v1` and `gateway.*` wire-v1 compatibility strings, and added an Apifox-importable OpenAPI contract for `/health`, `/ws`, live turn, event, status, capability, history, ask, planning, and executive-loop examples.
  Reason: The project model is an intelligent lifeform, not a session/chat gateway; socket is the correct owner for live turns, events, operations, and ledger query/replay while `brain.db` remains ledger/query/replay/audit only and context assembly remains Memory + Crystal + explicit Scope/Fork.
  Verification: pending final full validation; early checks passed `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`; `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`; `bun run docs:check`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: socket-wire-closure-final-validation
  Summary: Completed the socket wire closure review, removed active future-work prompts that still owned `src/agent/gateway`, corrected directory docs so live `src/executive` remains an active owner, and kept historical gateway references limited to wire-v1 compatibility, old-docs, logs, TODO history, and naming fixtures.
  Reason: The final handoff must not leave stale owner instructions for future tmux/worktree waves after moving the vascular transport layer to `src/socket`.
  Verification: `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`; `bun test tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts`; `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`; `bun run docs:check`; `bun run check`; `bun run build:binary`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: socket-polish-pass
  Summary: Promoted `socket` to the primary CLI/package/service naming, kept `gateway` as compatibility aliases and wire-v1 vocabulary, tightened Apifox OpenAPI client envelope schemas, fixed event subscription class examples, and reinforced docs/tests against active gateway-as-owner drift.
  Reason: After the physical `src/socket` migration, release-facing docs, scripts, service plans, and OpenAPI needed polish so new users and Apifox scenarios start from socket semantics without breaking existing v1 clients.
  Verification: `bun run docs:check`; `bun run check`; `bun test tests/gateway.control.smoke.test.ts tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts tests/naming.boundaries.test.ts tests/install.script.test.ts tests/docs.references.test.ts`; `bun run test`; `bun run build:binary`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: socket-owner-polish-pass-2
  Summary: Moved working-memory recovery smoke startup to the primary `socket` command, renamed composition-root internals to `socket` with a legacy `gateway` injection alias, and polished active Executive/README/tmux wording away from Gateway owner language.
  Reason: The socket migration was functionally sealed, but a few active startup and coordination surfaces still made future work look like it should launch or depend on Gateway as an owner rather than the socket vascular layer.
  Verification: `bun run check`; `bun test tests/docker.runtime.smoke.test.ts tests/gateway.control.smoke.test.ts tests/install.script.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `bun run scripts/working.memory.recovery.smoke.ts`; `bun run docs:check`; `bun run test`; `bun run build:binary`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: control-state-reconciliation
  Summary: Reconciled root TODO status markers for already-reviewed wave2/wave3 work, appended the latest socket-owner/full-suite state, and updated bilingual workflow handoff text so wave4 and socket-wire layouts read as reviewed/restorable history instead of active child-agent work.
  Reason: The code and validation state had advanced past the older orchestration notes; leaving those notes open would mislead the next parallel Codex wave about which branches still need review or validation.
  Verification: `bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `bun run docs:check`; `bun run check`; `bun run test`; `bun run build:binary`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: socket-smoke-entrypoint-polish
  Summary: Promoted socket-primary smoke/dev scripts while leaving legacy gateway-named scripts as thin compatibility wrappers.
  Reason: The active vascular owner is `src/socket`; user-facing smoke and dev entrypoints should no longer teach contributors to run gateway-named implementation files, while v1 wire and CLI compatibility remain intact.
  Verification: `bun run check`; `bun test tests/gateway.control.smoke.test.ts tests/install.script.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`; `bun run smoke:socket:control`; `bun run smoke:socket:ask-loop`; `bun run smoke:socket:service`; `bun run docs:check`; compatibility wrappers `bun run scripts/gateway.control.smoke.ts`, `bun run scripts/gateway.ask.loop.smoke.ts`, `bun run scripts/gateway.service.smoke.ts`; `git diff --check`; `bun run test`; `bun run build:binary`

- Status: open
  Actor: main-codex
  Scope: seal-wave-real-model-allocation
  Summary: Started the next seal wave from a clean single `master`, created `codex/seal-coordinator`, and allocated seven worktrees for docs alignment, Apifox/OpenAPI scenarios, real-model socket scenarios, prompt optimization, DB/context guard, zero-character audit, and release/binary seal.
  Reason: The Bun intelligent-lifeform kernel is mostly sealed; the next closure needs real configured-model scenarios, Apifox-importable contracts, prompt quality, cautious DB/context evolution, and release gates without bringing Rust work into this repository.
  Verification: pending tmux launch, child branch pushes, focused slice validations, live scenario, full deterministic suite, binary build, and final cleanup

- Status: completed
  Actor: main-codex
  Scope: socket-openapi-scope-narrowing
  Summary: Narrowed the active seal wave to socket layer plus OpenAPI/Apifox only, merged the OpenAPI/Apifox and real-model socket scenario slices into `codex/seal-coordinator`, and pushed the coordinator branch.
  Reason: The user explicitly moved external adapters, Rust work, prompt optimization, DB/context evolution, zero-character audit, and release/binary seal out of the immediate round so the project can close the socket blood-vessel layer and Apifox test surface first.
  Verification: `bun test tests/docs.references.test.ts tests/protocol.control.test.ts tests/gateway.ws.test.ts tests/gateway.module.test.ts`; `bun run docs:check`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`; `git push origin codex/seal-coordinator`

- Status: open
  Actor: main-codex
  Scope: socket-openapi-only-reallocation
  Summary: Stopped old active tmux development sessions, kept existing worktrees as additive history, and prepared a new three-lane socket/OpenAPI-only wave for runtime wire polish, Apifox drift guard polish, and live scenario coverage.
  Reason: The active development pool was short by three useful processes and still carried old broader seal lanes; a narrower worktree wave keeps throughput high without letting paused prompt/DB/release work leak back into the socket/OpenAPI closure.
  Verification: pending new branch creation, tmux launch, child Codex reports, focused validations, review, merge, and cleanup

- Status: completed
  Actor: socket-runtime-wire-polish
  Scope: socket-runtime-wire-polish
  Summary: Tightened the `/ws` runtime wire edge cases by returning structured JSON on authorized upgrade failure and preserving protocol parser details on invalid-envelope error responses.
  Reason: The active socket surface already covered `/health`, `/ws`, hello, ping/pong, status, capability, history, turn, and event lanes; this pass closes small error/upgrade mismatches without changing v1 wire strings or touching DB/context behavior.
  Verification: `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`; `bun run check`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: socket-openapi-only-wave-review
  Summary: Reviewed and merged socket runtime wire polish, OpenAPI drift guard, and real socket live coverage into `codex/seal-coordinator`; added the coordinator closeout for `/ws` 400 `gateway_control_upgrade_failed` in the Apifox contract.
  Reason: The active round is limited to socket layer plus OpenAPI/Apifox; the merged slices close runtime error consistency, contract drift, and real configured-provider scenario coverage without changing wire-v1 names, DB/context assembly, or the minimal `/health` + `/ws` HTTP surface.
  Verification: `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`; `bun test tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`; `bun run docs:check`; `bun run check`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`; `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`; `git diff --check`

- Status: open
  Actor: main-codex
  Scope: scope-vector-seal-wave-orchestration
  Summary: Expanded `flyflor-seal` to cover all active lanes, created `codex/scope-vector-core` and `codex/scope-vector-tests`, and launched remaining zero-character and Scope Vector child agents while keeping the coordinator on the verified Scope Vector baseline.
  Reason: The user requested full worktree firepower and stronger coordinator control; Scope graph indexing is now a first-class seal wave instead of an implicit main-thread patch.
  Verification: `git worktree list --porcelain`; `tmux list-windows -t flyflor-seal -F '#I:#W #{pane_current_path} #{pane_current_command}'`

- Status: completed
  Actor: main-codex
  Scope: scope-vector-coordinator-baseline
  Summary: Added `ScopeVectorComponent` with its own SQLite DB, deterministic vector codec, bounded hot-subtree cache, codename/scope lookup, and MemoryModule prompt/turn/scope/codename integration.
  Reason: Permanent Scope entities need a fast graph/tree index and recall layer without loading every Scope into memory, without applying forgetting curves, and without turning `brain.db` into prompt context.
  Verification: `bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/memory.brain.wire.test.ts`; `bun run check`; `git diff --check`

- Status: completed
  Actor: release-binary-seal
  Scope: release-binary-seal-review
  Summary: Confirmed binary/install/docker-dev/release-assets/socket-service checks pass without code or doc changes; `smoke:release` is blocked by the local Docker daemon being unavailable.
  Reason: Bun binary packaging is a hard seal criterion, but the remaining release smoke blocker is environment availability rather than repository code.
  Verification: `bun run build:binary`; `bun test tests/install.script.test.ts tests/docker.dev.smoke.test.ts tests/release.assets.test.ts`; `bun run smoke:socket:service`; `git diff --check`; blocked `bun run smoke:release` with `Cannot connect to the Docker daemon at unix:///Users/yi./.docker/run/docker.sock`

- Status: completed
  Actor: db-context-guard
  Scope: db-context-guard-review
  Summary: Reviewed ledger/context boundaries and made test-only fixes around history replay assertions; no runtime code, DB schema, or context assembly changes were made.
  Reason: The seal wave allows DB/context evolution only when necessary; this pass confirmed the current boundary is sound and corrected tests to assert persisted replay content rather than an original transport message id.
  Verification: `bun test tests/brain.store.test.ts tests/brain.archive.test.ts tests/context.scope.test.ts tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts`; `bun run check`; `git diff --check`

- Status: completed
  Actor: socket-live-coverage
  Scope: socket-regression-coverage
  Summary: Added socket-level regression coverage for successful `/ws` upgrade and empty `history.list` replay boundary without product logic changes.
  Reason: The socket vascular layer needs regression guards for the minimal HTTP surface and replay-only history behavior while preserving v1 wire compatibility.
  Verification: `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`; `git diff --check`

- Status: completed
  Actor: main-codex
  Scope: full-worktree-closeout-review
  Summary: Launched every recorded `flyflor-seal` worktree lane with real Codex workers, reviewed all child outputs, merged the safe socket-runtime, socket-coverage, OpenAPI drift, and zero-character guard increments, and kept the coordinator Scope Vector implementation as canonical.
  Reason: The user explicitly asked for coordinator control and no ignored worktrees; this closeout converts the parallel wave into verified mainline increments while rejecting duplicate or off-architecture proposals.
  Verification: `tmux list-panes -a -F '#{window_index}:#{window_name}:#{pane_current_command}:#{pane_dead}'`; `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/docs.references.test.ts tests/naming.boundaries.test.ts`

- Status: rejected
  Actor: main-codex
  Scope: child-lane-rejections
  Summary: Rejected the alternate `src/entities/scope` Scope Vector split, skipped/proposal Scope Vector tests, and the socket-live change that converted provider-not-ready from fail-fast into an `ok: false` report.
  Reason: Scope Vector already has a canonical coordinator owner under `src/cognitive/hippocampus/scope/vector`; live model gates must fail clearly when the configured provider is not ready.
  Verification: review of `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`, `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests`, and `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios` diffs

- Status: in-progress
  Actor: main-codex
  Scope: master-handoff
  Summary: Updated the handoff target from `codex/seal-coordinator` to `master` and prepared to commit the coordinator snapshot before merging it into the main branch.
  Reason: The next environment/session should start from the canonical mainline, not a staging branch.
  Verification: pending commit, checkout `master`, merge, push

# Flyflor TODO

## Current Handoff

Status: Bun kernel sealed. The mainline is now the Cognitive-Executive-Agent Architecture with a minimal WebSocket/event gateway. The old first-party shell code has been removed and no compatibility backup directory remains.

This file is the handoff note for the next conversation. It should describe only the current contract and the next work. Historical plans live under `docs/old-docs/` and must not redefine runtime behavior.

Latest active owner note: `src/socket` owns the socket vascular layer. Older lines in this TODO that place gateway under `src/agent` are preserved as historical task state and are superseded for new work.

## Sealed Contract

- Context assembly is `Memory + Crystal + explicit Scope/Fork + Executive visible capability surface`.
- `brain.db` is the ledger/query plane, not a prompt container.
- `Scope` is the only explicit work domain.
- `ContextFork` is an explicit branch under scope.
- `codename` is only an anchor, proposal entry, and recall boost.
- No explicit scope means no fallback scope, no inbox scope, and no hidden work domain.
- Gateway provenance is audit/routing metadata only. It is not a cognitive continuity owner.
- Core ownership uses explicit owner keys: `scope:<id>`, `fork:<id>`, `codename:<id>`, or turn-local owner keys.
- `activeProject` is compatibility input only; new code, tests, and docs use `activeScope`.
- MCP/HTTP/SSE/stdio protocol handshakes may exist at the wire layer, but they are not Flyflor continuity.

## Completed In This Reset

- Removed legacy first-party CLI/TUI/channel shell code from the repository.
- Removed hidden continuity binding from core cognition/storage paths.
- Renamed public route identity from chat-oriented naming to `conversationKey`.
- Renamed core storage columns and owners to `owner_key`, `source_key`, and `source_surface`.
- Removed actor/chat/channel identity fields from core memory, scope, fork, graph, working-memory, summary, ask, ghost, identity, and replay assumptions.
- Reworked tests to use explicit scope/fork/turn-local owners instead of implicit actor or channel continuity.
- Updated docs so active contracts describe the Context plane and Ledger/query plane as separate systems.
- Kept `mindstream`, `hippocampus`, `crystal`, `dream`, and `Gem` names intact.
- Kept prompt prose under `templates/prompts` and verified prompt docs/manifest sync.
- Kept every canonical Markdown source paired with a `.zh.cn.md` Chinese review copy.

## Current Mainline

- `src/cognitive`: mindstream, hippocampus, crystal, memory, scope, dream.
- `src/executive`: capability registry, tool planning, trust/guard, computer exoskeleton.
- `src/agent`: runtime, gateway, blackboard, sandbox, context, skills, worker, MCP, plugin.
- `src/events`: runtime event fabric.
- `src/protocol`: public contracts and WS/control envelopes.
- `src/entities`: SQLite entities, repos, schema owners.
- `src/components`: component base and shared infrastructure.

Main visible surfaces:

- Local stdio debug chat.
- Minimal Gateway: `/ws`, `/health`.
- Rust/thin-client contract: `docs/control.protocol.md`, `docs/ws.doc.md`, `docs/runtime.events.md`.
- Rust implementation handoff: `docs/rust.integration.md`, `docs/rust.connection.core.md`, `docs/rust.gateway.shell.backlog.md`.

## 2026-05-22 Kernel Integration Wave 2

- [x] Removed the HTTP `/channels` surface from the active minimal Gateway.
- [x] Kept the WS `gateway.status.get` control snapshot lane intact.
- [x] Carried a live `clientCount` through gateway status snapshots so peer pressure stays observable without reopening `/channels`.
- [x] Merged the context-memory clock-driven recall slice back into mainline and re-ran the mainline validation set.
- [x] Pinned the Rust/thin-client docs and docs guard so `clientCount` stays defined as live WS peer count, not static channel count.

## 2026-05-22 Kernel Wave 2 Tmux Orchestration

- [x] Preserved and pushed the previous `wt/kernel-scope-crystal-ask` ready-for-review control commit.
- [x] Created fresh wave2 worktrees from `main-codex-docs@c6d963f`.
- [x] Started `flyflor-wave2` tmux orchestration with memory, runtime, and scope child Codex windows.
- [x] Added `bun run kernel:tmux -- --wave2` as the reproducible restore entrypoint.
- [x] Review and merge `wt/wave2-memory-seal`.
- [x] Review and merge `wt/wave2-runtime-executive`.
- [x] Review and merge `wt/wave2-scope-crystal`.
- [x] Run mainline validation after wave2 slices land.

## Next Work

0. Treat the next phase as a coordinated large refactor whose target is the full intelligent-lifeform kernel, not just isolated seal fixes; every pause or handoff must update the repo handoff docs before ending.
1. Implement Rust shell slices from `docs/rust.gateway.shell.backlog.md`.
2. Keep Bun mainline focused on cognition, Executive, WebSocket/event protocol, memory, blackboard, sandbox, MCP, and plugin surfaces.
3. Continue shrinking `activeProject` to compatibility-only code paths; do not use it in new contracts.
4. Keep `brain.db` query/replay behavior separate from prompt assembly.
5. Keep scope-local prompt recall behind scope memory indexes, summaries, and vector/summary-first retrieval.
6. Keep all new prompt prose in `templates/prompts` with `.zh.cn.md` copies.
7. Keep all new Markdown paired with `.zh.cn.md`.
8. Add tests before changing protocol, storage schema, or runtime context assembly.
9. Align all active docs with the "intelligent lifeform kernel" framing before starting multi-worktree implementation.
10. Introduce append-only `LOGS.md` control files for the main worktree and future child worktrees.
11. Split the first document pass into three child worktrees after the mainline architecture anchor is updated.
12. Keep the active code-worktree split (`wt/kernel-context-memory`, `wt/kernel-scope-crystal-ask`, `wt/kernel-runtime-executive-ws`) alive until the WS-visible intelligent-lifeform kernel loop is complete.
13. Preserve `bun run kernel:tmux` as the new-environment restore entrypoint for worktree + tmux orchestration.
14. Keep the HTTP Gateway pruned to `/ws` and `/health` while preserving the WS `gateway.status.get` control snapshot lane and the live peer-count signal.

## Red Lines

- Do not reintroduce implicit continuity keys based on actor, chat, channel, thread, connection, or transport metadata.
- Do not create fallback scope or inbox scope when no explicit scope exists.
- Do not read raw `brain.db` event streams directly into prompts.
- Do not make codename an implicit context container.
- Do not let blackboard create its own long-lived transport-level container.
- Do not restore removed first-party shell paths or compatibility shells.
- Do not add magical abstractions or cryptic names.
- Keep OOP + composition style.
- Keep directory and filename conventions as the first contract.
- Keep zero character matching for business semantics.

## Validation

Run these before handing off code changes:

```bash
bun run check
bun run docs:check
bun run test
bun run build:binary
```

Last sealed validation in this workspace passed:

- `bun run check`
- `bun run docs:check`
- `bun run test` with 820 passing tests
- `bun run build:binary`

## Search Guard

Before ending a refactor turn, run the repository continuity vocabulary guard from the active test suite. Do not paste the forbidden tokens into docs or prompts just to document the check.

```bash
bun test tests/todo.status.test.ts tests/naming.boundaries.test.ts
```

The expected result is a clean pass.

## 2026-05-22 Seal Addendum

- Main coordinator branch: `main-codex-docs`
- Reviewed child branches kept pushed for resume:
  - `wt/docs-memory-philosophy`
  - `wt/docs-scope-ask`
  - `wt/docs-protocol-events`
- Recovery path is sealed for new sessions:
  - legacy monthly `brain.db` shards now self-upgrade missing `memory_events` columns before owner indexes are created
  - `working.memory.recovery.smoke.ts` now runs in an isolated temp home and forces explicit `FLYFLOR_HOME`, so repo worktrees no longer leak `.config/prompts` or WAL state into smoke recovery
- New-session resume rule:
  1. read `docs/boundaries.md`
  2. read `docs/development.workflow.md`
  3. inspect `git status --short --branch`
  4. inspect `git worktree list`
  5. recreate tmux/worktree execution from the documented branch ownership map

Latest full seal validation in this workspace passed:

- `bun run kernel:seal`
- deterministic suite: `821 pass`, `0 fail`
- `bun run smoke:agent`
- `bun run smoke:recovery`
- `bun run build:binary`
- `bun run build:binary:docker`
- `bun run test:live`
- `bun run smoke:agent:live`

## 2026-05-22 Gateway Control Slice Addendum

- Added a real `/ws` thin-client smoke for the Rust shell handoff path:
  - `server.hello`
  - `gateway.status.get`
  - `capability.catalog.get`
  - `gateway.message.send`
  - `turn.delta`
  - `turn.final`
- This smoke is deterministic and uses a scripted streaming model, so it verifies the stable control surface without live provider cost.

## 2026-05-22 Coordinator Mode Addendum

- Active meta-goal is now larger than seal maintenance: complete the intelligent-lifeform kernel refactor in coordinated slices.
- Mainline coordinator rules for every pause/stop:
  1. update `TODO.md`
  2. update `LOGS.md`
  3. update `docs/development.workflow.md`
  4. update `docs/development.workflow.zh.cn.md`
  5. push every changed branch/worktree branch before yielding the repository
- When implementation pressure rises, split code work into new `git worktree + tmux + Codex` slices instead of stretching one thread too far.
- Active code worktrees initialized from `main-codex-docs`:
  - `wt/kernel-context-memory`
  - `wt/kernel-scope-crystal-ask`
  - `wt/kernel-runtime-executive-ws`
- New environment restore command:
  - `bun run kernel:tmux`
  - `bun run kernel:tmux -- --launch-codex`

## 2026-05-22 Kernel Integration Addendum

- Integrated the first three code slices back into `main-codex-docs`:
  - context-memory
  - scope-crystal-ask
  - runtime-executive-ws
- Mainline now carries:
  - monthly live brain shard rollover that recreates a fresh live `brain.db`
  - graph/crystal recall accounting and explicit gem forgetting hooks
  - ask parser enforcement for non-freeform structured asks
  - scope scaffold trigger persistence in `.flyflor/scope.json`
  - ws thin-client loop closure coverage across ask pause/resume, event subscription, history replay, and request correlation
- Immediate next kernel gaps:
  - move from protocol-closed `/ws` loop coverage to fuller end-to-end executive capability execution under the intended trust surface
  - continue integrating forgetting/decay and vector recall behavior into broader kernel seal validation

## 2026-05-22 Kernel Wave2 Review Addendum

- [x] Pushed wave2 child branches for coordinator review:
  - `wt/wave2-memory-seal`
  - `wt/wave2-runtime-executive`
  - `wt/wave2-scope-crystal`
- [x] Reviewed and staged the memory seal slice into `main-codex-docs`:
  - deterministic activation and graph recall tie-breakers
  - injected recall cache clock usage
  - deterministic contradiction audit edge timestamps
- [x] Reviewed and staged the runtime/executive slice into `main-codex-docs`:
  - real `EventsComponent` gateway control smoke wiring
  - WS `event.publish` assertions for executive loop pause/resume
- [x] Reviewed and staged the scope/crystal slice into `main-codex-docs`:
  - nested non-freeform ask validation
  - explicit scope ledger row creation during codename promotion
  - crystal gem metadata provenance for source candidates and consolidation evidence
- [x] Kept HTTP Gateway closed to `/ws` and `/health`; no `/channels` surface was restored.
- [x] Run final mainline validation for the merged wave2 snapshot:
  - `bun run check`
  - `bun run docs:check`
  - `bun run build:binary`
- [x] Commit and push the reviewed wave2 integration from `main-codex-docs`.

## 2026-05-22 Kernel Wave3 Orchestration Addendum

- [x] Keep all previous kernel and wave2 worktrees intact; do not delete old execution history.
- [x] Created fresh wave3 branches from `main-codex-docs@281108e`:
  - `wt/wave3-memory-lifecycle`
  - `wt/wave3-runtime-capability`
  - `wt/wave3-scope-constitution`
- [x] Created fresh wave3 worktrees:
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-memory-lifecycle`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-runtime-capability`
  - `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
- [x] Added `bun run kernel:tmux -- --wave3` as the reproducible restore entrypoint.
- [x] Push the three wave3 child branches before child work begins.
- [x] Launch `flyflor-wave3` child Codex windows after the orchestration commit lands.
- [x] Main Codex review rule: merge only reviewed implementation/test surfaces back to `main-codex-docs`; write canonical TODO/LOGS/workflow history from the main worktree.

## 2026-05-22 Wave3 Scope Constitution Review

- [x] Reviewed `wt/wave3-scope-constitution`.
- [x] Merged the implementation/test surface into `main-codex-docs`:
  - `ScopeScaffolder` now distributes full bilingual scope constitution files.
  - Existing scope files remain no-overwrite/idempotent.
  - Scope scaffold and codename promotion tests now cover the expanded template set.
- [x] Verified on mainline with:
  - `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

## 2026-05-22 Wave3 Residual Cleanup

- [x] Pushed `wt/wave3-memory-lifecycle` with validation-only handoff notes; no implementation was merged from that branch.
- [x] Pushed `wt/wave3-runtime-capability` with exploration notes; the incomplete runtime/protocol prototype was discarded and no implementation was merged from that branch.
- [x] Pushed `wt/wave3-scope-constitution` after the local validation log tail.
- [x] Stopped active wave3 child Codex processes and left all wave3 worktrees clean.

## 2026-05-22 Kernel Wave4 Runtime Capability Addendum

- [x] Plan wave4 as one P0 split across three narrow runtime capability lanes:
  - `wt/wave4-runtime-smoke`
  - `wt/wave4-runtime-metadata`
  - `wt/wave4-runtime-history`
- [x] Keep previous kernel/wave2/wave3 worktrees intact; wave4 is additive.
- [x] Create and push the three wave4 branches from `main-codex-docs@1f45a72`.
- [x] Launch `flyflor-wave4` child Codex windows after the orchestration commit lands.
- [x] Main Codex review rule: merge only passing implementation/test slices; failed prototypes must be discarded and recorded without dirty tails.
- [x] Review wave4 child outputs as they land and keep mainline canonical TODO/LOGS/workflow history separate from local child notes.

## 2026-05-22 Wave4 Runtime Capability Review

- [x] Reviewed `wt/wave4-runtime-metadata` and merged the implementation/test surface:
  - typed `executiveToolExecutions` live reply metadata
  - bounded MCP/user capability execution projection
- [x] Reviewed `wt/wave4-runtime-history` and merged the control/history surface:
  - compact planning replay metadata
  - replay-only execution metadata projected from structured ledger provenance
  - no session restore or prompt assembly path
- [x] Reviewed `wt/wave4-runtime-smoke` and merged the smoke/test surface after replacing the new history success assertion with structured execution metadata checks.
- [x] Verified the integrated mainline snapshot with focused gateway/runtime/history tests, `bun run check`, `bun run docs:check`, `git diff --check`, and `bun run build:binary`.
- [x] Stopped active wave4 child Codex processes and left the `flyflor-wave4` tmux layout as restorable shell windows.
- [x] Confirmed mainline and all wave4 worktrees are clean and synced with origin.

## 2026-05-22 Socket Wire Closure Addendum

- [x] Created additive socket-wire worktrees for the planned A-E split:
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.core`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.openapi`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/life.constitution.docs`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.tests`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/ledger.context.boundary`
- [x] Created `flyflor-socket-wire` tmux layout with main/A/B/C/D/E windows.
- [x] Main Codex took over implementation after child agents were redirected to review mode, keeping the worktree history additive and avoiding stale child edits.
- [x] Moved active socket owner from `src/agent/gateway` to `src/socket` while preserving `flyflor.ws.v1`, `flyflor.event.v1`, `/ws`, `/health`, and `gateway.*` wire-v1 compatibility names.
- [x] Added `SocketModule` and `SocketControlHub` as active internal names with compatibility exports for existing v1 Gateway control vocabulary.
- [x] Added Apifox-importable contract:
  - `docs/openapi/flyflor.socket.openapi.json`
  - `docs/openapi/flyflor.socket.openapi.md`
  - `docs/openapi/flyflor.socket.openapi.zh.cn.md`
- [x] Guarded `gateway.message.send`, `gateway.status.get`, and `gateway.status.snapshot` as stable wire-v1 compatibility strings.
- [x] Reaffirmed `history.list` as `brain.db` ledger/query/replay/audit only, not session restore and not prompt/context assembly.
- [x] Run final full validation for the socket wire closure:
  - focused socket/wire tests
  - ledger/context tests
  - docs checks
  - `bun run check`
  - `bun run build:binary`
- [x] Commit and push the reviewed socket wire closure from `main-codex-docs`.

## 2026-05-22 Socket Wire Closure Final State

- [x] Active socket owner is now `src/socket`; any older TODO wording that places gateway under `src/agent` is historical and superseded for new work.
- [x] HTTP surface remains `/health` and `/ws`; `/channels` stays removed.
- [x] Wire-v1 compatibility remains locked for `flyflor.ws.v1`, `flyflor.event.v1`, `gateway.message.send`, `gateway.status.get`, and `gateway.status.snapshot`.
- [x] `docs/openapi/flyflor.socket.openapi.json` is present for Apifox import and is guarded by docs reference tests.
- [x] `brain.db` remains ledger/query/replay/audit only; context assembly remains Memory + Crystal + explicit Scope/Fork + Executive visible capability surface.
- [x] Final validation passed:
  - `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/gateway.dedup.test.ts tests/protocol.control.test.ts`
  - `bun test tests/tui.chat.history.test.ts tests/memory.brain.wire.test.ts tests/context.scope.test.ts tests/graph.recall.test.ts`
  - `bun test tests/docs.references.test.ts tests/todo.status.test.ts tests/naming.boundaries.test.ts tests/runtime.executive.boundaries.test.ts`
  - `bun run docs:check`
  - `bun run check`
  - `bun run build:binary`
  - `git diff --check`

## 2026-05-22 Polish Addendum

- [x] Superseded older top-level handoff wording that still placed gateway under `src/agent`; active owner is `src/socket`.
- [x] Kept `flyflor gateway`, `GatewayMessage`, and `gateway.*` names only as CLI/wire compatibility vocabulary, not architecture owner names.
- [x] Added `flyflor socket` / `bun run socket` as the primary socket entrypoint while keeping `gateway` aliases for compatibility.
- [x] Shifted service smoke, quality gates, README commands, and workflow docs to socket-first naming.
- [x] Tightened Apifox OpenAPI with `SocketClientEnvelope`, `flyflor.event.v1` event.publish examples, required payload schemas for `history.list` / `gateway.message.send`, and `client.hello` shape alignment.
- [x] Guarded docs against `event.subscribe.classes=["gateway"]`; examples now use `classes=["control"]`.
- [x] Final polish validation passed:
  - `bun run docs:check`
  - `bun run check`
  - focused socket/install/docs tests
  - `bun run test`
  - `bun run build:binary`
  - `git diff --check`

## 2026-05-22 Socket Owner Polish Pass 2

- [x] Shift working-memory recovery smoke startup from the legacy `gateway` command to the primary `socket` command while leaving the existing `gateway` config schema untouched.
- [x] Rename FlyFlor composition-root internals from `gateway` to `socket`, keeping a legacy `gateway` injection alias for compatibility.
- [x] Polish active Executive/README/tmux wording so non-wire owner language points at socket instead of Gateway.

## 2026-05-22 Control State Reconciliation

- [x] Supersede the older `Current Mainline` wording: `src/socket` is the active socket vascular owner, while `src/agent` owns runtime/blackboard/sandbox/context/skills/worker/MCP/plugin.
- [x] Supersede older validation counters with the latest full deterministic suite: `838 pass`, `0 fail`.
- [x] Mark the already-reviewed wave2 and wave3 orchestration checklist items complete without deleting their historical placement.
- [x] Reconcile the workflow handoff so wave4 and socket-wire layouts are described as reviewed/restorable history, not active child-agent work.

## 2026-05-22 Socket Smoke Entrypoint Polish

- [x] Promote `scripts/socket.control.smoke.ts`, `scripts/socket.ask.loop.smoke.ts`, `scripts/socket.service.smoke.ts`, and `scripts/socket.dev.sh` as the active smoke/dev entrypoints.
- [x] Keep `scripts/gateway.*` as compatibility wrappers only; `gateway.*` remains wire-v1/CLI compatibility vocabulary, not an active architecture owner.
- [x] Point `smoke:socket:*`, README dev guidance, and focused smoke tests at the socket-primary entrypoints.
- [x] Run focused socket smoke/install/docs checks, full suite, binary build, and diff hygiene for this polish pass.

## 2026-05-22 Seal Wave Real-Model Allocation

- [x] Reset to single `master` mainline before the new seal wave.
- [x] Created coordinator branch `codex/seal-coordinator` from `master`.
- [x] Created seal wave worktrees:
  - `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
- [x] Assign this wave to Bun kernel seal only; Rust is explicitly out of this repository and will be developed separately.
- [x] Merged and pushed the socket-only subset from this wave:
  - `codex/apifox-openapi-scenarios`
  - `codex/socket-live-model-scenarios`
- [x] Verified the socket-only subset with focused socket/protocol/docs tests, `bun run docs:check`, configured-provider readiness, `smoke:socket:live`, and `test:live`.
- [x] Paused the broader docs/prompt/DB/zero-character/release lanes for this round after scope was narrowed to socket layer and OpenAPI/Apifox.
- [x] Stopped old active tmux development sessions while preserving their worktrees as additive history.
- [x] Reallocate a new socket-only tmux/worktree wave from `codex/seal-coordinator`.
- [x] New socket-only merge order is runtime wire polish, OpenAPI/Apifox drift polish, live scenario coverage.
- [x] Final socket-only acceptance passed with focused socket tests, OpenAPI/docs guards, provider readiness, `smoke:socket:live`, `test:live`, `bun run check`, and diff hygiene.

## 2026-05-22 Socket/OpenAPI-Only Reallocation

- [x] Current coordinator branch is `codex/seal-coordinator` at `e5102a5`.
- [x] `docs/openapi/flyflor.socket.openapi.json` is present and guarded for Apifox import.
- [x] `scripts/socket.live.scenario.ts` and `smoke:socket:live` are present and pass against the configured provider.
- [x] `/channels` remains removed; HTTP socket surface remains `/health` and `/ws`.
- [x] `gateway.*` names remain v1 wire compatibility only.
- [x] Create `codex/socket-runtime-wire-polish` at `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish`.
- [x] Create `codex/apifox-openapi-drift-guard` at `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard`.
- [x] Create `codex/socket-live-coverage` at `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage`.
- [x] Launch `flyflor-socket-openapi` tmux with main/runtime/openapi/live windows.
- [x] Review, merge, validate, push, and clean this socket-only wave.

## 2026-05-22 Socket Runtime Wire Polish

- [x] Keep `/health` returning `{ ok: true }` and `/ws` as the only upgrade route; `/channels` remains 404.
- [x] Keep `flyflor.ws.v1`, `flyflor.event.v1`, and `gateway.*` v1 wire strings unchanged.
- [x] Return structured JSON when an authorized `/ws` upgrade fails.
- [x] Preserve protocol parse details on `error` envelopes for invalid control protocol input.
- [x] Validate with focused gateway/control tests, `bun run check`, and `git diff --check`.

## 2026-05-22 Socket/OpenAPI-Only Wave Final State

- [x] Merged `codex/socket-runtime-wire-polish` commit `923f5cb`.
- [x] Merged `codex/apifox-openapi-drift-guard` commit `6ed3e71`.
- [x] Merged `codex/socket-live-coverage` commit `5f91d77`.
- [x] Added coordinator OpenAPI closeout for `/ws` 400 `gateway_control_upgrade_failed`.
- [x] `smoke:socket:live` now proves capability catalog, socket `event.publish`, `turn.delta`, `turn.final`, and `history.list` replay against the configured provider.
- [x] No wire-v1 string changed, no DB/context schema changed, and `/channels` stayed removed.

## 2026-05-22 Scope Vector Seal Wave

- [x] Expanded `flyflor-seal` tmux from a single coordinator window to all active worktree lanes.
- [x] Created additional Scope Vector worktrees:
  - `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`
  - `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests`
- [x] Main coordinator implemented a verified Scope Vector baseline in the coordinator worktree:
  - independent Scope Vector DB, now defaulting to each Scope project's `.flyflor/scope.db`
  - `ScopeVectorComponent`
  - deterministic Scope vector codec
  - bounded hot subtree recall
  - MemoryModule prompt/turn/scope/codename integration
- [x] Scope Vector keeps `brain.db` as ledger/query/replay/audit only and does not add a forgetting curve to permanent Scope entities.
- [x] Verified coordinator Scope Vector baseline:
  - `bun test tests/scope.vector.test.ts tests/context.scope.test.ts tests/codename.promote.test.ts tests/memory.brain.wire.test.ts`
  - `bun run check`
  - `git diff --check`
- [x] Socket runtime wire worker reported no runtime changes needed; v1 wire and `/health` + `/ws` surface remain stable.
- [x] Apifox/OpenAPI worker polished `docs/openapi/**`; wire strings, DB schema, and context assembly unchanged.
- [x] Prompt optimization worker completed canonical `.md` and `.zh.cn.md` prompt updates in its worktree.
- [x] DB/context worker completed ledger/query/replay guard review with test-only fixes; DB schema and context assembly unchanged.
- [x] Socket coverage worker added socket regression coverage only; product logic unchanged.
- [x] Release/binary worker passed binary/install/docker-dev/release-assets/socket-service checks; `smoke:release` is blocked only by Docker daemon not running.
- [x] Review and merge completed worktree diffs into `codex/seal-coordinator` in a conflict-aware order.
- [x] Collect zero-character and Scope Vector child reports, then decide whether to merge their work or keep them as review evidence.
- [x] Run final seal validation after merges.

## 2026-05-22 Full Worktree Closeout Review

- [x] Launched all recorded `flyflor-seal` tmux/worktree lanes with real Codex workers, not idle shells.
- [x] Accepted socket-runtime naming polish: internal logs now use `socket.control`; v1 `gateway.*` wire strings remain unchanged.
- [x] Accepted socket coverage increments for successful `/ws` upgrade and correlated `turn.delta` / `turn.final` envelopes.
- [x] Accepted OpenAPI drift guard increments that bind Apifox schema enums and examples back to runtime protocol readers.
- [x] Accepted zero-character audit expansion across blackboard, worker, context, full memory, scope, and Executive semantic paths.
- [x] Kept the coordinator `ScopeVectorComponent` as canonical; rejected the child `scope-vector-core` alternate `src/entities/scope` owner split for this round.
- [x] Rejected `scope-vector-tests` proposal tests because they were skipped/proposal-shaped and duplicated the canonical Scope Vector test surface.
- [x] Rejected the socket-live worker change that downgraded provider-not-ready from fail-fast to an `ok: false` report; live gate must fail clearly when no configured provider is ready.
- [x] Kept docs-lane Rust wording as review evidence only where it was too broad; this repo remains Bun-kernel focused while existing Rust handoff docs stay external references.

## 2026-05-22 New Session Handoff Seal

- [x] Prepared the repository for a fresh Codex session on `codex/seal-coordinator`.
- [x] Staged one coherent handoff snapshot covering Scope Vector, socket/OpenAPI drift guard, prompt polish, DB/context tests, zero-character guard, and release notes.
- [x] Confirmed all `flyflor-seal` tmux panes returned to shell and all recorded worktrees remain available as review evidence.
- [x] Confirmed accepted child-lane changes are in coordinator and rejected child-lane proposals are documented with reasons.
- [x] Final validation before handoff:
  - `bun run docs:check`
  - focused socket / Scope Vector / DB-context / docs / naming tests
  - `bun run check`
  - `bun run build:binary`
  - `bun run test` (`850 pass`, `0 fail`)
  - `git diff --check`
- [x] Known environment-only blocker remains Docker daemon availability for the compose portion of `smoke:release`.

## 2026-05-22 Master Handoff

- [x] Final handoff target is `master`, not `codex/seal-coordinator`.
- [x] `codex/seal-coordinator` is only the staging/coordinator branch for this seal wave.
- [x] Commit the staged coordinator snapshot.
- [x] Switch the current worktree back to `master`.
- [x] Merge the coordinator snapshot into `master`.
- [x] Push `master` for the next session.

## 2026-05-22 Scope DB Vector Closure

- [x] Move default Scope Vector persistence from the shared vector DB to each Scope project's `.flyflor/scope.db`.
- [x] Keep injected `dbFile` support for tests and explicit migration tooling.
- [x] Add `scope_tree_nodes`, `scope_hot_memory`, and `scope_associations` tables beside `scope_vectors` and `scope_vector_edges`.
- [x] Write active-scope turn summaries into scope hot memory while leaving full turn ledger authority in `brain.db`.
- [x] Open scope-local DB files on demand during recall, neighbor lookup, and hot-scope listing.
- [x] Cover scope-local DB isolation, hot memory recall rendering, and association evidence in `tests/scope.vector.test.ts`.
- [x] Update workflow, memory, and architecture docs so `brain.db` remains ledger/query/replay/audit/detail only.

## 2026-05-22 Kernel V2 Clean Slate Orchestration

- [x] Commit and push the current Scope DB Vector closure to `master`.
- [x] Remove all old local worktrees so the repository has one clean coordinator worktree.
- [x] Delete old local development branches, including previous `wt/*`, `main-codex-docs`, `y-branch-1`, and GitButler workspace branches.
- [x] Prune stale remote refs and delete old remote `codex/*` development branches.
- [x] Leave `origin/master` as the only remote branch.
- [x] Record the new full-kernel worktree split before launching child work.
- [x] Create and push the new Kernel V2 worktrees:
  - `wt/kernel-scope-memory`
  - `wt/kernel-fork-ask-crystal`
  - `wt/kernel-runtime-executive`
  - `wt/kernel-socket-protocol`
  - `wt/kernel-release-seal`
  - `wt/docs-contracts-report`
- [x] Launch child Codex lanes once, then stop them at user request before accepting any child changes.
- [ ] Initialize each new worktree with independent local `TODO.md`, `AGENTS.md`, and `LOGS.md` control sections before relaunching parallel Codex work.
- [ ] Relaunch child Codex lanes only after their local control files state task list, work status, local red lines, change-log requirements, and handoff conditions.
- [ ] Require every child worktree to commit local control-file updates together with its implementation/docs work before main Codex review.

Kernel V2 acceptance focus:

- Scope / Memory must close `scope.db` as the scope-local vector/tree/hot-memory/association index while `brain.db` remains ledger/query/replay/audit/detail only.
- Fork mode must behave like a branch: a conversation can enter a `ContextFork`, users can ask the LLM to merge it, conflicts trigger ASK, and successful closure can crystallize.
- ASK ghost mode must preserve unanswered ASK state; users can `continue` instead of losing the pending branch/scope/loop snapshot.
- Runtime / Executive must run the nanobot-style context path: current input + Memory + Crystal + explicit Scope/Fork + Executive visible capability surface.
- Socket protocol must expose the stable `/ws` vascular surface without restoring `/channels` or turning transport metadata into cognitive continuity.

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
- [ ] Review and merge `wt/wave2-memory-seal`.
- [ ] Review and merge `wt/wave2-runtime-executive`.
- [ ] Review and merge `wt/wave2-scope-crystal`.
- [ ] Run mainline validation after wave2 slices land.

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
- [ ] Push the three wave3 child branches before child work begins.
- [ ] Launch `flyflor-wave3` child Codex windows after the orchestration commit lands.
- [ ] Main Codex review rule: merge only reviewed implementation/test surfaces back to `main-codex-docs`; write canonical TODO/LOGS/workflow history from the main worktree.

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

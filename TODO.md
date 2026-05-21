# Flyflor TODO

## Current Handoff

Status: Bun kernel sealed. The mainline is now the Cognitive-Executive-Agent Architecture with a minimal WebSocket/event gateway. The old first-party shell code has been removed and no compatibility backup directory remains.

This file is the handoff note for the next conversation. It should describe only the current contract and the next work. Historical plans live under `docs/old-docs/` and must not redefine runtime behavior.

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
- Minimal Gateway: `/ws`, `/health`, `/channels`.
- Rust/thin-client contract: `docs/control.protocol.md`, `docs/ws.doc.md`, `docs/runtime.events.md`.
- Rust implementation handoff: `docs/rust.integration.md`, `docs/rust.connection.core.md`, `docs/rust.gateway.shell.backlog.md`.

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
12. Local slice owner: `wt/kernel-runtime-executive-ws`.
13. Owned files for this worktree:
    - `src/agent/runtime/**`
    - `src/agent/gateway/**`
    - `src/executive/**`
    - related tests, docs, and smoke scripts for ws control, events, history, and executive loop closure
14. Local target:
    - `/ws` completes the thin-client lifecycle across hello, catalog, send, delta, final, history, and loop metadata
    - executive loop pause/resume stays explicit and observable
    - gateway/runtime protocol surfaces are stable enough for Rust shell follow-on work
15. Local handoff rule:
    - update this worktree `TODO.md` and `LOGS.md`
    - commit only owned files
    - do not rewrite mainline handoff docs from this branch

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

## 2026-05-22 Runtime Closure Addendum

- Completed in this worktree:
  - `/ws` now preserves client `requestId` as runtime correlation for the matching `turn.*` envelopes.
  - gateway control smoke now covers the thin-client ask pause/resume loop, event subscription, and history replay in one deterministic run.
  - ws docs now spell out the current loop-closure contract for thin clients instead of leaving it implicit.
  - gateway ws tests now guard class-based event subscriptions and request-correlation stability.
- Next coordinator action after merge:
  - keep this branch as the runtime/ws implementation slice reference
  - re-run mainline validation after integrating memory and crystal slices with these ws protocol guarantees

## 2026-05-22 Runtime-Executive-WS Closure Addendum

- Local slice status: completed for the current ws/runtime/executive closure pass.
- Closed local target details:
  - `/ws` now keeps the client envelope `requestId` as the runtime request correlation key for turn and event surfaces.
  - Thin-client smoke now covers `server.hello`, `event.subscribe`, `gateway.status.get`, `capability.catalog.get`, `gateway.message.send`, loop pause/resume, `history.list`, and `history.snapshot`.
  - Lifecycle-class event subscription is covered so Rust/thin clients can subscribe by runtime event class without per-request coupling.
  - Executive loop pause/resume closure is verified through explicit `turn.final.reply.metadata.ask` and `executiveToolLoop` snapshots rather than hidden transport state.
- Remaining local follow-on:
  - Keep future Rust shell work aligned to the documented `/ws` control, event, history, and loop metadata contract without introducing private transport patches.

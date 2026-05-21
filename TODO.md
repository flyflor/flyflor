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

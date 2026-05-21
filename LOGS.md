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

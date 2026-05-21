# Docs Protocol Events — LOGS

## 2026-05-21

- Status: open
  Actor: main-codex
  Scope: wt/docs-protocol-events
  Summary: Initialized this document worktree and assigned its owned document set.
  Reason: The first documentation pass is split into focused worktrees so each branch can update one coherent document surface without cross-branch edits.
  Verification: worktree created from commit `ae038bd`

- Status: completed
  Actor: main-codex
  Scope: wt/docs-protocol-events
  Summary: Refined the control protocol and runtime event docs so explicit scope, ask, and loop surfaces stay separate from transport continuity and event timelines.
  Reason: The protocol-facing branch needed to clarify that `turn.final.reply.metadata` remains the current-turn authority while events remain audit/time-series surfaces.
  Verification: pending mainline review

## 2026-05-22

- Status: completed
  Actor: child-codex
  Scope: wt/docs-protocol-events
  Summary: Finalized the branch-owned protocol and runtime event wording so `activeScope`, explicit ask/pause/resume surfaces, and `turn.final.reply.metadata` stay authoritative while transport metadata and runtime events remain non-continuity surfaces.
  Reason: The worktree handoff required the owned docs, TODO state, and append-only log to match the architecture anchor before commit.
  Verification: `bun test tests/docs.references.test.ts`

- Status: completed
  Actor: main-codex
  Scope: wt/docs-protocol-events
  Summary: Mainline review accepted the owned protocol and runtime-event refinements and merged the target docs back to `main-codex-docs`.
  Reason: This worktree is now a completed local branch record; the canonical merged history lives on the coordinator branch.
  Verification: reviewed commit `6a6d0c2`; merged on mainline commit `4c21957`

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

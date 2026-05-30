# Workmux Development Plan

## Purpose

Flyflor uses visible workmux-style development for parallel work. Child Codex agents run in cmux panes and independent worktrees so the owner can inspect their reasoning and progress.

This plan applies to future parallel implementation. The current closed-loop
investigation and repair did not launch child processes because the owner
explicitly requested no child processes for this work.

## Lane Control Files

Every worktree under `.worktrees/*` contains:

- `AGENTS.md`: read-only red lines.
- `PLAN.md`: read-only lane assignment.
- `TODO.md`: status changes and appends only.
- `LOGS.md`: append-only changed-file log.
- `STATUS.md`: progress, blockers, validation, and handoff.

## Complete Implementation Lanes

Recommended lanes for the full agent:

- `docs-brain-memory`: red lines, research report, context/memory/brain design.
- `brain-db`: monthly brain audit DB and artifact references.
- `memory-tree`: working memory graph, retrieval traces, recovery state.
- `context-engine`: question-aware context build, compaction, checkpoints.
- `model-runtime`: OpenAI-compatible streaming and tool-call loop.
- `tool-runtime`: internal tools, orchestration, event semantics.
- `plugin-module`: `@Plugin`, PluginModule, CodeGraph and RTK adapters.
- `socket-observability`: test web page and debug protocol.
- `evaluation`: real-model scenario tests and restart recovery checks.

## Merge Discipline

The coordinator owns all merges. A child lane is not merged because it completed; it is merged only after review, validation, and conflict pressure evaluation.

After a child Codex exits, its cmux pane should be closed to save display space.

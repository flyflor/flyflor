# Reference Agent Evidence

## Purpose

This document records local reference implementation evidence used for the
current Flyflor runtime design. It is evidence for architecture decisions, not a
copy target.

## Codex

Relevant paths:

- `reference/codex/codex-rs/core/src/context_manager/history.rs`
- `reference/codex/codex-rs/core/src/tools/spec_plan.rs`
- `reference/codex/codex-rs/core/src/tools/router.rs`
- `reference/codex/codex-rs/core/src/tools/orchestrator.rs`
- `reference/codex/codex-rs/core/src/context/contextual_user_message.rs`

Observed call chains:

- `ContextManager::for_prompt()` -> `normalize_history()`
- `normalize_history()` -> `ensure_call_outputs_present()` ->
  `remove_orphan_outputs()` -> `strip_images_when_unsupported()`
- `build_tool_router()` -> `build_tool_specs_and_registry()` ->
  `add_tool_sources()` -> `build_model_visible_specs_and_registry()`
- `ToolRouter::build_tool_call()` ->
  `dispatch_tool_call_with_terminal_outcome()`
- `ToolOrchestrator::run()` -> approval -> sandbox -> attempt -> retry

Design consequence for Flyflor:

Codex strongly protects history and tool call/output invariants. Flyflor should
keep context rewriting explicit and auditable, and should build model-visible
tools from structured runtime state instead of exposing the whole registry.

## Hermes Honcho

Relevant path:

- `reference/hermes-agent/plugins/memory/honcho/__init__.py`

Observed call chain:

- `prefetch()` returns no injected memory for trivial prompts.
- `queue_prefetch()` also returns immediately for trivial prompts.
- `_is_trivial_prompt()` exists to stop stale context from harming short
  one-word replies.

Design consequence for Flyflor:

Short direct turns must not receive stale memory or old task tail in the answer
context. Flyflor keeps the host free of user-text intent classifiers, so this
is enforced by model-selected context source groups and runtime isolation
policy rather than by host keyword checks.

## DeepSeek-TUI

Relevant paths:

- `reference/DeepSeek-TUI/README.md`
- `reference/DeepSeek-TUI/crates/tui/src/core/engine.rs`

Observed behavior:

The auto router mainly selects model and thinking behavior. It does not act as a
heavy host-side memory/tool/task router.

Design consequence for Flyflor:

Flyflor's host should collect clue packets, audit decisions, and enforce
boundaries. It should not grow a parallel semantic classifier based on user
characters or keyword rules.


# Agent Runtime Overview

## Purpose

This document is the current map of Flyflor's agent runtime. It explains the
runtime layers, method-level call chain, and ownership boundaries that must stay
true while implementation changes.

## Capability Surface

- `src/socket`: Bun WebSocket adapter and static debug page serving.
- `src/kernel`: turn orchestration, tool loop, recovery state, and audit writes.
- `src/context`: turn-decision clue packet, model-backed intent decision,
  context construction, and compaction.
- `src/memory`: hot no-session memory, graph/vector/tree recall, facts, tasks,
  checkpoints, retrieval traces, and rebuild support.
- `src/brain`: monthly full-fidelity audit database and artifact references.
- `src/signal`: `SignalBus` event, guard, final, fail, and timeout flow.
- `src/tools`: built-in tools compiled into the Bun binary.
- `src/plugins`: optional project-local plugin host and external adapters.
- `src/config`: `.config/config.jsonc` loading and typed access.
- `prompts`: runtime prompt text; TypeScript must not embed runtime prompts.
- `sql`: initialization schema for brain and memory databases.

## Main Turn Chain

The primary call chain is:

1. `SocketServerService.handleMessage()` receives `chat.message`.
2. `AgentRuntimeService.runTurn()` creates a turn id and writes `brain_turns`.
3. `MemoryComponent.appendMessage()` and `BrainComponent.recordMessage()`
   persist the user message.
4. `AgentRuntimeService.emitPluginDiagnostics()` records optional plugin state.
5. `ContextIntentAnalyzerComponent.analyze()` builds a clue packet and asks the
   configured real model for JSON.
6. `ContextIntentAnalyzerComponent.buildCluePacket()` gathers current input,
   bounded recent conversation, latest checkpoint, recovery state, and
   knowledge-tree candidates.
7. `ContextIntentAnalyzerComponent.parseModelDecision()` validates JSON and
   derives `contextPolicy`, `targetConfidence`, and `writeTargetRoot`.
8. `AgentRuntimeService.recordCluePacket()` writes
   `turn.clue_packet.created`.
9. `AgentRuntimeService.recordIntentDiagnostic()` writes
   `turn.decision.completed` and `context.intent`.
10. `AgentRuntimeService.storeDurableFacts()` persists only model-requested
    durable facts.
11. `ContextBuilderService.build()` injects only selected context source groups.
12. `AgentRuntimeService.buildContextWithBudgetGuard()` compacts only when the
    selected context exceeds budget.
13. `AgentRuntimeService.visibleToolsForDecision()` maps selected tool groups
    to concrete tools and applies runtime target gates.
14. `AgentRuntimeService.recordToolVisibility()` writes
    `tool.visibility.resolved`.
15. `AgentRuntimeService.executeInlineTools()` runs only decision-authorized
    project inspection or exact shell evidence.
16. `AgentRuntimeService.streamModelStep()` calls the configured model with
    model-visible tools.
17. `AgentRuntimeService.executeModelToolCall()` validates tool visibility,
    target root, shell command scope, and schema before execution.
18. `ToolRegistry.execute()` emits `tool.call`, writes `brain_tool_calls`,
    executes the tool, emits result events, and stores artifacts.
19. `AgentRuntimeService.guardMidTurnContextBudget()` compacts oversized
    model-loop context while preserving tool call/result invariants.
20. `AgentRuntimeService.runTurn()` writes assistant final to memory and brain,
    records recovery completion, and emits `chat.final`.

## Isolation Rules

- `direct_reply` uses `contextPolicy=isolated` and should inject only
  `current_user` and `runtime`.
- `clarify_reference` asks the user when candidate targets are ambiguous.
- `memory_answer` uses memory-scoped sources selected by the turn decision.
- `investigate` and `code` must carry an explicit project path before project
  tools or mutating edit tools target a non-default root.
- Mutating model tools are gated by the derived target fields, not by user-text
  keyword matching.

## Current Regression Evidence

The May 30 investigation found two separate failures:

- At 2026-05-30 16:07, a plain greeting triggered 19 tool calls.
- At 2026-05-30 18:40, the same greeting no longer triggered tools but still
  inherited stale `flyflor-front` task context.

The current runtime contract is that greeting/direct turns receive no tools, no
old task tail, and no model-visible durable recall unless the turn-decision
model explicitly selects the corresponding context source groups.


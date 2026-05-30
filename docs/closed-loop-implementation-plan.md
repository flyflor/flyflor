# Closed-Loop Agent Implementation Record

## Purpose

This document records the closed-loop requirements that must remain true for
Flyflor's no-session coding agent. It replaces older phase language with the
current implementation contract and validation evidence.

## Current State

- `brain.db` is a monthly full-fidelity audit path for turns, messages, events,
  tool calls, artifacts, and recovery points.
- `memory.db` stores messages, chunks, deterministic embeddings, facts,
  entities, relations, claims, decisions, tasks, artifacts, checkpoints,
  retrieval traces, and recovery state.
- Memory critical indexes can be rebuilt from monthly `brain.db` after memory
  loss.
- Turn decisions are made by the configured real LLM from a structured clue
  packet. The host does not route by matching user characters.
- Context injection and model-visible tool groups are chosen by the model
  decision, then bounded by runtime policy.
- The tool loop validates schemas, writes brain audit rows, emits observable
  events, and can continue after failed tool results.
- Socket tests prove chat, tool, guard, artifact, memory, context, plugin, and
  recovery events are observable.
- RTK and CodeGraph adapters resolve project-local plugin paths and emit
  explicit unavailable or failed diagnostics when unavailable.

## Memory And Vector Tree

Implemented contract:

1. `MemoryComponent` exposes APIs for entities, relations, facts, claims,
   decisions, tasks, artifacts, and tree recall.
2. Facts and chunks are linked into graph nodes with evidence references.
3. Recall combines lexical, vector, fact, graph-neighborhood, recency,
   importance, and conflict signals.
4. Retrieval traces explain selected results and graph edges.
5. Scenario coverage proves question-centered recall chooses the relevant fact
   instead of stale unrelated project facts.

## Attention And Turn Decision

Implemented contract:

1. `ContextIntentAnalyzerComponent` builds a provenance-backed clue packet from
   current input, recent conversation, checkpoint, recovery state, and
   knowledge-tree candidates.
2. `prompts/intent.md` asks the configured LLM for one compact JSON turn
   decision. The Chinese mirror is `prompts/intent.zh.cn.md`.
3. The decision records mode, confidence, selected and candidate task ids,
   clarification state, context source groups, tool visibility groups, project
   path, shell command, derived context policy, target confidence, write target
   root, model-requested facts to store, and reasons.
4. Project inspection, shell execution, durable fact capture, context
   injection, and model-visible tools consume only this structured decision.
5. If the decision call is missing, invalid, truncated, or fails, the runtime
   fails the turn explicitly, records recovery and brain diagnostics, and does
   not infer intent from user text.
6. Scenario coverage uses the real configured DeepSeek/OpenAI-compatible path;
   core runtime no longer has an automatic mock provider route.

## Context Compaction

Implemented contract:

1. Pre-turn budget guard compacts older model-selected recent messages when the
   assembled context exceeds `context.maxContextChars`.
2. Mid-turn budget guard rewrites oversized loop context after inline or
   model-requested tool results.
3. Compaction summaries preserve tool call/result ids, tool names, result
   status, paths, symbols, requirements, decisions, tasks, conflicts, and
   artifact references.
4. Compaction checkpoints carry source ids and brain/signal diagnostics.
5. Real-model scenario coverage verifies facts survive the selected context
   path and that stale recent tails are not injected when the model does not
   request them.

## Tool And Plugin Runtime

Implemented contract:

1. The registered tool surface is deterministic and duplicate-free.
2. Tools expose execution metadata: read-only/concurrent or mutating/serial.
3. Model-visible tools are derived from model-selected tool groups, not from the
   full registry.
4. RTK and CodeGraph are optional project-local plugins. Missing or failed
   plugins emit `plugin.availability`, `plugin.unavailable`, or
   `plugin.failed` diagnostics and return explicit failed tool metadata.
5. Scenario coverage verifies plugin unavailability, CodeGraph coding-only behavior,
   RTK raw artifact preservation, tool schema validation, path boundary
   rejection, and socket-visible tool events.

## Workmux Boundary

Workmux lanes remain the required workflow for future parallel implementation.
This investigation and repair was performed in the coordinator worktree because
the owner explicitly requested no child processes for this work.

Future lane ownership remains:

- `memory.vector.tree`: `src/memory/**`, `sql/memory-schema.sql`, memory docs,
  memory scenario tests.
- `context.intent.compaction`: `src/context/**`,
  `src/kernel/agent.runtime.service.ts`, `src/kernel/model.provider.ts`,
  `prompts/intent*`, context/intent docs, context scenario tests.
- `tool.plugin.runtime`: `src/tools/**`, `src/plugins/**`,
  `.config/config.jsonc`, plugin/tool docs, tool scenario tests.

## Acceptance Evidence

The current closed loop is accepted only when evidence proves:

- Real turns are durable in both brain and memory.
- Recall is query-centered and graph/vector/tree-aware.
- Coding requests collect local evidence through tools before answering.
- Context compaction preserves critical model-loop invariants when budget
  requires it.
- Tool calls, results, artifacts, plugin failures, recovery state, context
  decisions, and clue-packet diagnostics are observable and audited.
- Scenario tests cover memory continuity, tree recall, context behavior,
  intent-driven inspection, plugin unavailable/failed diagnostics, tool boundaries, and socket
  observability.

Latest validation evidence:

- `bun test tests/scenario/no.session.agent.test.ts tests/scenario/memory.vector.tree.test.ts`:
  26 pass, 0 fail, 154 expect calls.
- `bun test tests/scenario/deepseek.inner.test.ts`: 1 pass, 0 fail,
  10 expect calls.
- `bun test tests/scenario/deepseek.full.test.ts`: 1 pass, 0 fail,
  17 expect calls.
- `bun test tests/scenario/signal.di.lifecycle.test.ts`: 3 pass, 0 fail,
  6 expect calls.
- `bunx tsc --noEmit`: pass.

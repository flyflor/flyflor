# Context, Memory, Brain, And Compaction Design

## Brain Database

`brain.db` is a monthly full-fidelity biography and audit database. It is created under `.config/brain/YYYY-MM.brain.db`.

It records:

- local runtime sessions,
- turns,
- every visible message,
- streaming deltas,
- visible reasoning summaries,
- tool calls and results,
- artifact references,
- memory writes and retrieval traces,
- context build and compaction events,
- sub-agent tasks and handoffs,
- recovery events.

It does not compress data. It is optimized for review, replay, forensics, and disaster recovery, not hot prompt construction.

## Memory Database

`memory.db` is the current working memory. It is optimized for recall and context construction.

It stores:

- conversation messages,
- memory documents and chunks,
- embeddings,
- entities,
- relations,
- facts,
- claims,
- decisions,
- tasks,
- artifacts,
- context checkpoints,
- retrieval traces,
- recovery state.

`memory.db` can be rebuilt from `brain.db` for critical indexes. `brain.db` cannot be replaced by `memory.db`.

Critical rebuild means a fresh `memory.db` can replay durable conversation
messages from `brain_messages`, restore the local conversation tail, and
restore model-selected durable facts from audited `memory.fact.stored` events.
It does not re-parse old user text to guess facts. Full vector/tree indexes are
then rebuilt by normal `MemoryComponent` writes during replay.

## Recall

Recall is query-centered. The current user input and its clue packet decide
which memory paths are relevant; neither the host nor memory layer may classify
the turn by matching arbitrary user characters.

The memory recall pipeline:

1. Build recall clues from the current input, explicit paths, visible task ids,
   known entities, recent checkpoint source ids, and recovery state.
2. Run lexical search for exact identifiers.
3. Run vector search for semantic similarity.
4. Traverse graph relations from matched entities.
5. Apply recency and importance boosts.
6. Detect conflicting facts.
7. Rerank and diversify results.
8. Persist a retrieval trace.

The model receives structured context only after the turn decision selects the
source groups to inject: facts, decisions, tasks, evidence, files, artifacts,
conflicts, checkpoints, recent tail, and open questions.

## Intent Diagnostics

Every turn produces a structured intent decision before evidence collection.
The host builds a provenance-backed clue packet from memory, knowledge-tree
candidates, recent messages, checkpoints, recovery state, and the current input.
The configured real model answers the prompt under `prompts/intent.md` and
returns compact JSON.

There is no mock provider route and no deterministic parser that turns user text
into a coding, greeting, continuation, or memory intent. If the model decision is
missing, invalid, truncated, or fails, the turn fails explicitly and the runtime
records diagnostics in memory, brain, recovery state, and SignalBus events.

The decision records mode, confidence, selected and candidate task ids,
clarification state, selected context source groups, selected tool visibility
groups, context policy, target confidence, write target root, project path,
shell command, model-requested facts to store, and diagnostic reasons.

Intent diagnostics are written to `brain.db` as `turn.clue_packet.created`,
`turn.decision.completed`, and `context.intent` events and are included in
socket-visible `context.ready` payloads. Project inspection, shell execution,
context injection, visible tools, and durable fact capture must consume this
structured decision instead of triggering directly from host-side keyword or
character matching.

Direct reply context is isolated. It does not consume recent task tail,
durable memory recall, structured facts, or knowledge-tree content unless the
turn-decision model selects those context source groups.

Knowledge-tree candidates collected for the turn-decision clue packet are
audited through `turn.clue_packet.created` and do not create retrieval traces.
Retrieval traces are written only when selected memory recall is actually used
for model-facing context or an explicit memory workflow.

## Compaction

Compaction rewrites model-facing context. It never deletes brain audit data.

Compaction modes:

- pre-turn context budget guard,
- mid-turn tool-loop compaction,
- post-turn checkpoint,
- handoff summary for sub-agents,
- recovery checkpoint after crash or restart.

Compaction must preserve:

- tool call/result pairs,
- file paths,
- class/function/interface/enum names,
- hashes, UUIDs, URLs, ports, and command lines,
- explicit user requirements,
- unfinished tasks,
- conflicting facts,
- source message ids and artifact ids.

Pre-turn compaction stores a checkpoint for older recent messages when the assembled context exceeds `context.maxContextChars`, then rebuilds model input with checkpoint source messages removed from the verbatim tail. Mid-turn compaction rewrites oversized model-loop messages into a checkpoint-style system message while preserving tool call ids, tool names, result status, paths, symbols, requirements, decisions, tasks, conflicts, and artifact references.

## Disaster Recovery

Recovery state is written before and after every critical operation:

- turn started,
- user message persisted,
- context built,
- model request started,
- tool call started,
- tool call completed,
- assistant final written,
- memory extraction completed,
- turn completed.

On startup the runtime scans the latest brain database and `memory_recovery_state`. Interrupted tools are marked interrupted, unfinished turns become recoverable, and the socket debug panel displays the recovery report.

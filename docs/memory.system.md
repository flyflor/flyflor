# Memory System

## Position

Flyflor separates prompt equipment from life ledger storage.

Context assembly uses constitution files, Memory, Crystal, explicit Scope, explicit ContextFork, and Executive visible capabilities. `brain.db` records life history for ledger/query/replay/audit/detail, but it is not a prompt container and does not automatically restore current context.

## Layers

| Layer | Owner | Role |
| --- | --- | --- |
| Constitution | `src/cognitive/hippocampus/memory/markdown`, workspace memory files, scope scaffolded files | Reads stable self/user/identity/memory/project rules such as `SELF.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, and `project.memory.md`. |
| Hot memory | `src/cognitive/hippocampus/memory/working`, `hot`, `recall`, `lifecycle` | Recent episodes, activation, TTL decay, compression, recall, and anti-bloat. |
| Memory tree / graph | `src/cognitive/hippocampus/memory/graph`, `recall/matrix.ts` | Association structure, recall matrix, relation weight, cluster impact, and provenance. |
| Scope-local memory | `src/cognitive/hippocampus/memory/scope`, `src/cognitive/hippocampus/scope` | Scope constitution, `project.memory.md`, scope vector/tree/hot memory, codename promotion, and task/fork continuity. |
| Crystal | `src/cognitive/crystal` | Stable reusable methods, Gem snapshots, vector recall, and drift repair. |
| Ledger | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | Monthly `brain.db`, archives, detail, history, replay, ASK, task, fork, and audit rows. |

## `brain.db`

`brain.db` is the writable current-month life ledger.

It stores and serves:

- turn ledger rows
- replay and detail anchors
- audit material
- Blackboard detail references
- task plans and fork records
- ASK and continuation records
- execution-job rows
- historical query snapshots through socket readers

It does not:

- directly assemble model prompts
- act as a session store
- own scope continuity
- infer current memory from `conversationKey`, `threadId`, user id, client id, or connection id
- authorize tools or approvals

Archived months become read-only shards. The current month remains writable.

## Hot Memory And Forgetting

Hot memory is intentionally unstable. It keeps recent evidence available while decay, compression, and consolidation decide what remains useful.

Hot memory is not volatile process memory. `MemoryComponent` must have a durable backend. The in-process Map/LRU view is only a performance cache; the recoverable authority is local snapshot/WAL or SQLite state. Mutations must be appended durably before the hot view changes. Startup recovery follows snapshot, WAL replay, health snapshot, then active-memory hydrate. A power cut may lose at most one torn final WAL line, never the whole active context window.

Forgetting is not only deletion:

- TTL and recency reduce activation over time.
- Hot compression summarizes recent material before it bloats prompt assembly.
- Consolidation and dream workers can turn repeated or valuable evidence into structured memory actions.
- Vector offsets and graph/matrix impact adjust recall weight.
- Contradictory or stale Crystal evidence can be repaired instead of blindly reused.

Production recall signals are numeric/resource signals such as embedding similarity, importance, recency, activation, cluster size, graph relation, vector offset, and provenance. They are not keyword intent rules.

## Vector Offset And Recall

Vector recall is an evidence-ranking mechanism, not a semantic authority by itself.

- Embedding similarity proposes candidates.
- Offset and graph/matrix signals adjust local ranking.
- Provenance, owner key, scope, fork id, recency, and activation determine whether the candidate is safe to equip.
- The model-facing prompt receives summarized/equipped memory, not raw vector rows.

This keeps recall useful without letting approximate vector neighbors become hidden continuity owners.

## Scope And Codename

`Scope` is the explicit durable work domain. It can have:

- local constitution
- `project.memory.md`
- scope-local vector/tree/hot-memory material
- local skills/MCP/plugin surfaces
- fork and task-plan continuity

`codename` is lighter. It is an anchor, proposal entry, and recall boost before scope promotion. It does not automatically open a scope and is not a hidden context bucket.

Scope recall is model-gated:

1. Memory lists candidate scopes/codenames and scope-local evidence.
2. `ScopeRecallComponent` asks the model for structured `none | load | ask`.
3. `load` equips the scope for the current turn.
4. `ask` produces ASK for confirmation.

Scope hot memory is also durable. The default context/index plane is the scope-local `.flyflor/scope.db`; it stores vector/tree/hot-memory/association material and can be rebuilt into prompt equipment without treating `brain.db` as the prompt container.

## ContextFork

`ContextFork` is an explicit branch under the current work context. It enters prompt assembly only when `RuntimeContext.contextForkId` is supplied or a structured runtime path creates/continues it.

Fork details are kept in the ledger/query plane. Merge conflicts produce ASK rather than silent overwrite.

## Crystal Relationship

Memory handles hot and recent experience. Crystal handles stable reusable knowledge.

Crystal candidates can come from high-value ASK answers, completed forks, Blackboard convergence, replay/task-plan outcomes, and reflection evidence. Gem promotion is quality gated; it is not based on a raw transcript count or automatic event copying.

## Prompt Rule

Allowed prompt equipment:

- current request
- constitution files
- Memory recall and summaries
- Crystal recall
- explicit active Scope
- explicit ContextFork
- Executive visible capabilities

Disallowed prompt equipment:

- raw `brain.db` event stream
- transport session history as continuity
- user/thread/conversation/client metadata as memory owner
- CLI-local transcript state as kernel memory

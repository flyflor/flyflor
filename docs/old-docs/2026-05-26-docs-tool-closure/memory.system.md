# Memory System

## Position

Flyflor separates memory equipment from life ledger storage.

Context assembly uses Memory, Crystal and explicit Scope/Fork. `brain.db` records life history for ledger/query/replay/audit/detail, but it is not a prompt container and does not automatically restore current context.

## Layers

| Layer | Owner | Role |
| --- | --- | --- |
| Constitution | `src/cognitive/hippocampus/memory/markdown` and installed workspace files | Reads `SELF.md`, `IDENTITY.md`, `USER.md` and `MEMORY.md` as stable global profile material. |
| Hot memory | `src/cognitive/hippocampus/memory/working`, `hot`, `recall`, `lifecycle` | Recent episodes, activation, TTL decay, compression, recall and anti-bloat. |
| Memory tree / graph | `src/cognitive/hippocampus/memory/graph`, `recall/matrix.ts` | Association and recall structure driven by resource metrics, not keywords. |
| Scope-local memory | `src/cognitive/hippocampus/memory/scope` and `src/cognitive/hippocampus/scope` | Scope constitution, project memory, scope vector/tree/hot memory and codename promotion. |
| Crystal | `src/cognitive/crystal` | Stable reusable methods, Gem snapshots, vector recall and drift repair. |
| Ledger | `src/cognitive/hippocampus/memory/brain`, `src/entities/memory/brain`, `src/socket/query` | Monthly `brain.db`, archives, detail, history, replay and audit. |

## `brain.db`

`brain.db` is the writable current-month life ledger.

It stores and serves:

- turn ledger rows
- replay and detail anchors
- audit material
- blackboard detail references
- task plans and fork records
- ASK and continuation records
- historical query snapshots through socket readers

It does not:

- directly assemble model prompts
- act as a session store
- own scope continuity
- infer current memory from `conversationKey`, `threadId`, user id or connection id

Archived months become read-only shards. The current month remains the writable ledger.

## Hot Memory And Forgetting

Hot memory is intentionally unstable. It keeps recent evidence available while decay, compression and consolidation decide what remains useful.

Forgetting is not only deletion:

- TTL and recency reduce activation over time.
- Hot compression summarizes recent material before it bloats prompt assembly.
- Consolidation and dream workers can turn repeated or valuable evidence into structured memory actions.
- Vector offsets and graph/matrix impact adjust recall weight.
- Contradictory or stale Crystal evidence can be repaired instead of blindly reused.

The production recall signals are numeric/resource signals such as embedding similarity, importance, recency, activation, cluster size, graph relation and provenance. They are not keyword intent rules.

## Scope And Codename

`Scope` is the explicit durable work domain. It can have:

- local constitution
- `project.memory.md`
- `.flyflor/scope.db`-style vector/tree/hot-memory material
- local skills/MCP/plugin surfaces
- fork and task-plan continuity

`codename` is lighter. It is an anchor, proposal entry and recall boost before scope promotion. It does not automatically open a scope and is not a hidden context bucket.

Scope recall is model-gated:

1. Memory lists candidate scopes/codenames and scope-local evidence.
2. `ScopeRecallComponent` asks the model for structured `none | load | ask`.
3. `load` equips the scope for the current turn.
4. `ask` produces ASK for confirmation.

## ContextFork

`ContextFork` is an explicit branch under the current work context. It enters prompt assembly only when `RuntimeContext.contextForkId` is supplied or a structured runtime path creates/continues it.

Fork details are kept in the ledger/query plane. Merge conflicts produce ASK rather than silent overwrite.

## Crystal Relationship

Memory handles the hot and recent side of experience. Crystal handles stable reusable knowledge.

Crystal candidates can come from high-value ASK answers, completed forks, blackboard convergence, replay/task-plan outcomes and reflection evidence. Gem promotion is quality gated; it is not based on a raw transcript count or automatic event copying.

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
- user/thread/conversation metadata as memory owner

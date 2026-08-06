# Life Ledger

The life ledger is Flyflor's permanent, verbatim, append-only record of every conversation. It is
deliberately separate from the volatile in-memory `History`: what lands in the ledger is never
compressed, folded, summarized, or evicted. Recall, compression, and vector indexing are explicitly
out of scope for the ledger itself.

## Storage layout

```
<cwd>/.ledger/
  ledger-2026-08.db      # current hot shard (WAL)
  ledger-2026-07.db      # sealed cold shard
```

- One SQLite database per calendar month, keyed by the event's own local-time `YYYY-MM`.
- Every event carries an epoch-milliseconds `created_at`, so cross-shard ordering stays exact.
- Late events (for example a turn that completes just after midnight) are routed into the shard
  that owns their timestamp. At most two shard handles stay open: the current month plus one
  straggler month.
- Sealing a shard stamps `meta.sealed_at`, runs `PRAGMA wal_checkpoint(TRUNCATE)`, and closes the
  handle. Sealed shards are self-contained files that a future cold tier can gzip or move away.
- The directory defaults to `./.ledger` and resolves against the process cwd, never against
  `__dirname`, so compiled single-file binaries behave exactly like dev runs. Override it with the
  `ledger.directory` key in `.config/config.jsonc`; `ledger.enabled: false` disables the ledger.

## Schema (per shard, `meta.schema_version = 1`)

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  focus_id    TEXT,
  message_id  TEXT,
  speaker_id  TEXT,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_focus   ON events(focus_id);
CREATE INDEX IF NOT EXISTS idx_events_message ON events(message_id);
```

Shard pragmas: `journal_mode = WAL`, `synchronous = NORMAL`. The schema ships as TypeScript string
constants in `src/ledger/schema.ts`; the runtime never reads `.sql` files from disk, which keeps
`bun build --compile` binaries self-contained.

## Recorded events

| kind          | hook point                                   | payload                                        |
| ------------- | -------------------------------------------- | ---------------------------------------------- |
| `stimulus`    | `AgentManager.accept()` after dedupe         | the full `Stimulus`, including queued input    |
| `turn`        | `Context.complete()` before `History.record` | `{ focus, report }` verbatim and uncompressed  |
| `interaction` | `AgentManager.answer()`                      | `{ request, response }` for ask/confirm rounds |
| `cancellation`| `AgentManager.cancel()`                      | `{ focusId, revision, speakerId }`             |
| `agent_event` | `AgentManager.forwardAgentEvent()`           | the full `AgentRuntimeEvent` (tool actions)    |

Not recorded: streamed chunks (they duplicate the final answer) and rejected duplicate message ids
(transport retry noise).

## Failure policy

- Boot time: if the ledger directory cannot be created or the hot shard cannot be opened, startup
  throws. The process must never run silently unrecorded.
- Runtime: an individual write failure is logged (`ledger.record.failed`) and swallowed; the ledger
  must never break a conversation.

## Binary and cross-compile safety

- The ledger uses only `bun:sqlite`, which is statically built into the Bun runtime. There are no
  native `.node` addons on this path, so `bun build --compile --target=...` cross-compilation is
  unaffected.
- `pakcages/sqlite-vec` (per-platform native binaries) is intentionally not part of the ledger.
- Database paths derive from `process.cwd()`; no ledger code reads files relative to `__dirname`,
  which points into the virtual bunfs root inside compiled binaries.

## Code map

- `src/ledger/component.ts` — `Ledger`, the domain API (`recordStimulus`, `recordTurn`,
  `recordInteraction`, `recordCancellation`, `recordAgentEvent`).
- `src/ledger/repository.ts` — `LedgerRepository`, the only class that touches `bun:sqlite`;
  owns shard handles, schema bootstrap, append, seal, and close.
- `src/ledger/schema.ts` — schema, pragma, and insert SQL constants.
- `src/ledger/types.ts` — event kinds and the `LedgerEvent` envelope.

# Runtime Turn

## Entry

The hot path is `RuntimeModule.handleMessage` in `src/agent/runtime/module.ts`.

Socket mode starts in `SocketModule`:

1. `GET /ws` upgrades into `SocketControlHub`.
2. `gateway.message.send` is normalized into `GatewayMessage`.
3. `SocketModule.dispatch` creates or accepts a `RuntimeContext`.
4. Deduplication uses channel + message id and never becomes cognitive continuity.
5. `RuntimeModule.handleMessage` assembles the turn, runs model/tool loops, writes memory/ledger state and returns `GatewayReply`.
6. `/ws` emits `turn.delta`, `turn.final` or `turn.error`.
7. `EventsComponent` broadcasts RuntimeEvents for subscribers and audit sinks.

The local chat entry still exists for direct debugging, but `/ws` is the stable external surface.

## Turn Phases

The runtime code names the internal phase outputs around a single turn:

| Phase | Shape | Responsibility |
| --- | --- | --- |
| Prepare | `PreparedTurn` | Normalize context, compute embedding, read pending ASK/fork/scope state, evaluate fast-route signals and timing. |
| Assemble | `AssembledTurnContext` | Load skills, MCP servers, Memory prompt, sandbox policy, capability catalogs, plugin/user/external tools and Blackboard route state. |
| Generate | `GeneratedTurn` | Run the model, collect visible text, parse structured blocks, execute tool loops, collect provenance, task plans, forks, replay records and ASK metadata. |
| Persist/async | memory and event calls | Save episodes, ledger/detail rows, reflection candidates, scope/codename/fork evidence and runtime events. |

## Context Assembly

Runtime can equip:

- current request text and attachments
- Markdown constitution through Memory
- hot Memory recall and working-memory summaries
- Crystal recall and Gem knowledge
- explicit `activeScope`
- explicit `contextForkId`
- scope-local memory/index material when a scope is explicitly loaded
- Executive visible capability surface

Runtime must not equip raw `brain.db` event streams as prompt text. `brain.db` is used for provenance, replay, detail, audit and query surfaces.

## Routing, Scope And ASK

Route decisions are model- or structure-driven. Production semantic routing cannot use `text.includes`, regex intent rules or keyword dictionaries.

Scope recall follows a visible gate:

1. Runtime publishes a recall-start event.
2. Memory lists scope/codename candidates and scope-local evidence.
3. `ScopeRecallComponent` asks the model for structured `none | load | ask`.
4. `load` equips `activeScope` for the current turn.
5. `ask` returns an `AgentAsk` instead of guessing.

ASK is a normal runtime outcome. It appears when scope boundaries, fork merge conflicts, blackboard caps, crystallization gates, tool-loop limits, child subagent `needs_user`, or external tool stability failures need user judgment.

ASK v1 can carry multiple questions. Each question keeps one to three owner-proposed choices, a canonical `recommendedChoiceId`, and a fixed `other` option for user-owned freeform input. Runtime does not parse `other` text semantically; it preserves the answer as next-turn model input, audit data and possible Crystal evidence.

## Executive Loop Pause

Executive tool execution can pause a turn instead of hiding retries:

- `ExecutiveToolRuntime` returns structured ask-required state.
- Runtime publishes `executive.loop.paused`.
- The final reply metadata has `kind: "ask"` and includes the loop snapshot.
- `subagent.batch` pauses include `jobId` / `job` metadata and write append-only `brain.db.memory_events.type = "execution-job"` rows.
- external tool stability pauses use ASK source `tool-stability` and preserve the stability snapshot.
- A later user answer records an ask-answer pair and can publish `executive.loop.resumed`.

There is no private background continuation protocol. Resumption uses the next structured input and the existing `/ws` event/control surface.
`brain.db` only stores job/ASK ledger, query, replay, audit and detail data; job ledger rows are not prompt containers and do not participate in context assembly.

## Blackboard

Complex turns may route through `RuntimeBlackboardRouteComponent`. Blackboard operates on the already assembled turn context. It is not a transport-session memory owner and does not infer continuity from conversation/thread/user metadata.

If Blackboard hits a cap or conflict, `RuntimeBlackboardOutputComponent` hands the state back through ASK.

## Fork, Replay And Crystal

`ContextFork` records are explicit branches. Fork merge results, replay records, task plans, high-value ASK answers and completed blackboard work can become Crystal reflection evidence. Gem promotion is a later quality-gated step, not automatic transcript storage.

## Test References

Relevant deterministic coverage includes:

- `tests/gateway.ws.test.ts`
- `tests/gateway.control.smoke.test.ts`
- `tests/runtime.executive.boundaries.test.ts`
- `tests/runtime.mcp.tool.plan.test.ts`
- `tests/runtime.planning.route.test.ts`
- `tests/ask.wire.test.ts`
- `tests/continuation.wire.test.ts`
- `tests/context.scope.test.ts`

# Runtime Events

## Position

`src/events` is the event fabric. It publishes JSON-serializable RuntimeEvents, fans them out to sinks and lets `/ws` clients subscribe to event timelines.

Events are observability and coordination signals. They are not prompt containers and do not replace the ledger/query plane.

## Owners

| Path | Role |
| --- | --- |
| `src/events/runtime.event.ts` | Runtime event types and builders. |
| `src/events/component.ts` | Event component and hook registration. |
| `src/events/bus.ts` | Subscription/fan-out bus. |
| `src/events/sinks.ts` | Console/null/composite sinks. |
| `src/events/classifier.ts` | Event class mapping for subscriptions. |

## Event Examples

Important event families include:

- socket/gateway lifecycle: start, message received, dispatch failed
- turn lifecycle: delta/final/error visibility
- ASK lifecycle: ask created, answered, resumed
- Executive loop: `executive.loop.paused`, `executive.loop.resumed`
- tool lifecycle: calls, approvals, failures and summaries
- Memory/Crystal lifecycle: recall, consolidation, reflection and Gem evidence
- Scope recall and promotion events
- Blackboard detail and worker progress

## Event Matrix

| Event area | Authority |
| --- | --- |
| Current turn final state | 当前轮权威状态仍读 `turn.final.reply.metadata`. |
| Planning snapshots | 结构化快照仍读 `turn.final.reply.metadata.planning`. |
| Runtime timeline | `RuntimeEvent` 默认是时间线事实流. |
| Historical/detail inspection | Read `src/socket/query` snapshots and ledger/detail rows. |

## Socket Subscription

`event.subscribe` exposes RuntimeEvents through `/ws`. Subscription filters use event classes and event type names from the protocol. Realtime consumers should subscribe to events; historical consumers should query `src/socket/query` read models.

`/ws` `event.subscribe` / `event.publish` and snapshot query messages are the public boundary for TUI and other thin clients. They are vascular transport contracts, not private Runtime APIs. A client can render timeline changes from events, then load authoritative detail through query/read snapshots such as `blackboard.detail.get`, `ask.detail.get`, `execution.job.detail.get` or `gateway.status.get`.

Stable event type selectors are closed over `RuntimeEventType`; unknown selectors must return `invalid-payload` and must not enter socket subscription state. TUI-facing event payloads must carry stable ids needed for refresh and drilldown, including `askId` for `executive.loop.paused`, `jobId` / `batchId` / `childId` for subagent events, and `turnId` plus message/step/decision ids for Blackboard events.

## Boundary

Event payloads must be JSON serializable. They cannot carry sockets, streams, functions or class instances.

Events can include ids and provenance. They should not include provider secrets, private tokens or raw prompt context beyond what the event contract explicitly exposes.

## Tests

Relevant coverage:

- `tests/event.component.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.ws.test.ts`

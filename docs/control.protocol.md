# Control Protocol

## Surface

Socket control is exposed at:

- `GET /health`
- `GET /ws`

`/ws` speaks JSON control/event envelopes from `src/protocol/control/envelope.ts`. The stable protocol name is `flyflor.ws.v1`. Message names such as `gateway.message.send` are wire compatibility names.

## Core Message Families

Client-to-server messages include:

- `client.hello`
- `ping`
- `gateway.status.get`
- `capability.catalog.get`
- `gateway.message.send`
- `event.subscribe`
- `event.unsubscribe`
- `history.list`
- `history.snapshot`
- detail queries for ASK, Blackboard, Crystal, Fork, Replay, Scope, Task and Thought records

Server-to-client messages include:

- `server.hello`
- `ack`
- `gateway.status.snapshot`
- `capability.catalog.snapshot`
- `turn.delta`
- `turn.final`
- `turn.error`
- `event.publish`

## Context Input

`gateway.message.send.payload.context` is the explicit context entry point. Canonical fields are:

- `activeScope`
- `contextForkId`
- `skillNames`

Legacy `activeProject` may be accepted only as a compatibility read and must normalize immediately into `activeScope`.

Conversation, user, thread and connection fields are routing/audit metadata. They cannot select Scope, Memory owner or prompt assembly.

## Snapshot Matrix

| Snapshot | Source | Purpose |
| --- | --- | --- |
| Connection-level snapshot | `SocketModule.getStatusSnapshot()` and `SocketControlHub` | Transport health, client count, channel state and model/config visibility. |
| Turn-level snapshot | `turn.delta`, `turn.final`, `turn.error` | Current request progress and final reply metadata. |
| Capability snapshot | Executive catalog readers | Visible capabilities and hidden diagnostics. |
| Query/read snapshot | `src/socket/query` | Ledger/detail/history/replay read models. |
| Event stream | `src/events` through socket subscription | Realtime runtime, ASK, memory, tool, gateway and execution events. |

连接级 snapshot、turn 级 snapshot、事件流 must stay distinct. A status snapshot is not a replay record, and a ledger query is not a prompt context.

## Rust 最小接线清单

最小读取优先级建议：

1. Read `server.hello` for protocol and capability bootstrap.
2. Send `gateway.status.get` when the client needs a fresh connection snapshot.
3. Send live input through `gateway.message.send`.
4. Render `turn.delta`, then treat `turn.final` as the authority for the completed turn.
5. Read `reply.metadata.ask` for ASK UI state and `reply.metadata.executiveToolLoop` for long-horizon loop pause state.
6. Use read-model queries such as `history.list`, `ask.list`, `blackboard.detail.get`, `execution.job.list` and `execution.job.detail.get` for side panels.

The Rust/TUI layer should not infer cognitive continuity from connection ids, user ids, thread ids or transport actors. Scope and fork selection must come from explicit context payloads.

## Error

Errors use machine-readable codes from the control protocol. Invalid envelopes, missing payload fields and failed dispatches return structured error payloads rather than natural-language-only failures.

Common examples:

- `invalid-envelope`
- `invalid-payload`
- `unsupported-message`
- `gateway.message.send payload requires text`
- `gateway_control_not_ready`

## Tests

Relevant coverage:

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`

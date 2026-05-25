# WebSocket Manual

## Endpoint

Run the socket kernel:

```bash
bun run socket
```

The server exposes:

- `GET /health`
- `GET /ws`

Default local smoke examples use `ws://127.0.0.1:8788/ws`.

`/channels` is not part of the active HTTP surface.

## Envelope

All WebSocket frames are JSON envelopes using `flyflor.ws.v1` for control messages and `flyflor.event.v1` for event publications.

Typical client frame:

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "client-message-1",
  "type": "gateway.message.send",
  "payload": {
    "text": "Summarize the current scope.",
    "context": {
      "activeScope": {
        "id": "scope-123",
        "title": "Example",
        "projectDir": "/workspace/example",
        "projectMemoryDir": "/workspace/example/.flyflor/memory"
      }
    }
  }
}
```

## Important Types

The socket contract includes:

- `server.hello`
- `client.hello`
- `gateway.status.get`
- `gateway.status.snapshot`
- `capability.catalog.get`
- `capability.catalog.snapshot`
- `gateway.message.send`
- `turn.delta`
- `turn.final`
- `turn.error`
- `event.subscribe`
- `event.publish`
- `history.list`
- `history.snapshot`
- `ask.list`
- `blackboard.detail.get`

Error examples include `invalid-envelope` and `gateway.message.send payload requires text`.

Apifox scenario names include `ServerHello`, `ClientHello`, `GatewayStatusGet`, `CapabilityCatalogGet`, `HistoryList`, `GatewayMessageSend`, `TurnDelta`, `TurnFinal`, `TurnFinalWithAsk`, `TurnFinalWithPlanning`, `TurnFinalWithExecutiveLoopPause` and `InvalidPayloadError`.

`gateway.status.snapshot` includes `clientCount` as live WebSocket peer pressure. It is not a static channel count. The socket control hub also maintains `controlState` for active subscriptions and current control-plane state.

## Event Subscription

Subscribe with control classes, not the old gateway class name:

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "subscribe-1",
  "type": "event.subscribe",
  "payload": {
    "classes": ["control"],
    "types": ["executive.loop.paused", "executive.loop.resumed"]
  }
}
```

Use `"classes": ["control"]`; do not use the old gateway event class.

## Detail Query Envelope Matrix

Read-model queries are served from `src/socket/query`. They inspect ledger/detail state and do not assemble prompts.

| Request | Response style |
| --- | --- |
| `history.list` | historical turn list |
| `history.snapshot` | history snapshot |
| `history.detail.get -> history.snapshot` | detail query mapped into snapshot payload |
| `ask.list` / `ask.detail.get` | ASK records and pending snapshots |
| `blackboard.list` / `blackboard.detail.get` | Blackboard detail and worker output |
| `crystal.list` | Crystal/Gem read model |
| `fork.list` / `fork.detail.get` | ContextFork records |
| `replay.list` / `replay.detail.get` | Replay records |
| `scope.list` / `scope.detail.get` | Scope records |
| `task.list` / `task.detail.get` | Task plans |
| `thought.detail.get` | Thought/detail projection |

Detail payloads use `payload.data`.

历史对话列表获取 uses `history.list`; detail lookup uses `history.snapshot` and the detail request family above.

## Metadata To Expect

`turn.final` metadata may include:

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`
- `executiveToolExecutions`
- `executiveToolLoop`
- `planning`
- `ask`

Loop pauses and resumes also appear as events:

- `executive.loop.paused`
- `executive.loop.resumed`

## Actor And Context

Socket actors such as `ws-actor` are transport identities. They do not define cognitive continuity.

To select context, pass explicit `payload.context.activeScope`, `payload.context.contextForkId` or `payload.context.skillNames`.

Runtime metadata may mention `MemoryComponent`, `CrystalComponent` and `brain.db` provenance. That provenance is for read models and audit; it is not direct prompt assembly. A future wire v2 may rename compatibility `gateway.*` messages, but the current wire v1 keeps those names. `/channels` remains absent.

## Tests

Relevant coverage:

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`

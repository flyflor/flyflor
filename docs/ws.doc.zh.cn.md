# WebSocket 手册

## Endpoint

运行 socket kernel：

```bash
bun run socket
```

Server 暴露：

- `GET /health`
- `GET /ws`

默认本地 smoke 示例使用 `ws://127.0.0.1:8788/ws`。

`/channels` 不属于活跃 HTTP surface。

## Envelope

所有 WebSocket frames 都是 JSON envelope，control messages 使用 `flyflor.ws.v1`，event publications 使用 `flyflor.event.v1`。

典型 client frame：

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

## 重要类型

Socket contract 包括：

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

Error 示例包括 `invalid-envelope` 和 `gateway.message.send payload requires text`。

Apifox scenario names 包括 `ServerHello`、`ClientHello`、`GatewayStatusGet`、`CapabilityCatalogGet`、`HistoryList`、`GatewayMessageSend`、`TurnDelta`、`TurnFinal`、`TurnFinalWithAsk`、`TurnFinalWithPlanning`、`TurnFinalWithExecutiveLoopPause` 和 `InvalidPayloadError`。

`gateway.status.snapshot` 包含 `clientCount`，表示 live WebSocket peer pressure，不是静态 channel count。Socket control hub 也维护 `controlState`，用于 active subscriptions 和当前 control-plane state。

## Event Subscription

订阅使用 control classes，不使用旧 gateway class name：

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

使用 `"classes": ["control"]`；不要使用旧 gateway event class。

## Detail Query Envelope Matrix

Read-model queries 由 `src/socket/query` 服务。它们检查 ledger/detail state，不装配 prompts。

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

Detail payloads 使用 `payload.data`。

历史对话列表获取使用 `history.list`；detail lookup 使用 `history.snapshot` 和上面的 detail request family。

## 预期 Metadata

`turn.final` metadata 可能包含：

- `toolApprovals`
- `mcpToolCalls`
- `userToolCalls`
- `executiveToolExecutions`
- `executiveToolLoop`
- `planning`
- `ask`

Loop pause 和 resume 也会以 events 出现：

- `executive.loop.paused`
- `executive.loop.resumed`

## Actor 与 Context

`ws-actor` 等 socket actors 是 transport identity。它们不定义认知连续性。

选择 context 时，请传入显式 `payload.context.activeScope`、`payload.context.contextForkId` 或 `payload.context.skillNames`。

Runtime metadata 可能提到 `MemoryComponent`、`CrystalComponent` 和 `brain.db` provenance。该 provenance 服务 read model 和 audit，不直接参与 prompt assembly。未来 wire v2 可以重命名 compatibility `gateway.*` messages，但当前 wire v1 保留这些名称。`/channels` 仍不存在。

## 测试

相关覆盖：

- `tests/gateway.control.smoke.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.module.test.ts`
- `tests/tui.chat.history.test.ts`

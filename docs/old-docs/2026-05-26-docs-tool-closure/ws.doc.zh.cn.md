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
- `ask.detail.get`
- `ask.snapshot`
- `blackboard.detail.get`
- `fork.memory.get`
- `fork.memory.snapshot`
- `task.plan.decide`

Error 示例包括 `invalid-envelope` 和 `gateway.message.send payload requires text`。

Apifox scenario names 包括 `ServerHello`、`ClientHello`、`GatewayStatusGet`、`CapabilityCatalogGet`、`HistoryList`、`GatewayMessageSend`、`TurnDelta`、`TurnFinal`、`TurnFinalWithAsk`、`TurnFinalWithPlanning`、`TurnFinalWithExecutiveLoopPause` 和 `InvalidPayloadError`。

`gateway.status.snapshot` 包含 `clientCount`，表示 live WebSocket peer pressure，不是静态 channel count。Socket control hub 也维护 `controlState`，用于 active subscriptions 和当前 control-plane state。

## Event Subscription

订阅使用稳定 RuntimeEvent types。使用 classes 时必须匹配 runtime classifier；executive loop pause/resume 属于 ASK class：

```json
{
  "protocol": "flyflor.ws.v1",
  "id": "subscribe-1",
  "type": "event.subscribe",
  "payload": {
    "classes": ["ask"],
    "types": ["executive.loop.paused", "executive.loop.resumed"]
  }
}
```

对 ASK/executive-loop pause events 使用 `"classes": ["ask"]`，也可以省略 `classes` 只按精确 `types` 订阅。不要使用旧 gateway event class。

## Detail Query Envelope Matrix

Read-model queries 由 `src/socket/query` 服务。它们检查 ledger/detail state，不装配 prompts。

| Request | Response style |
| --- | --- |
| `history.list` | `history.snapshot` historical turn list |
| `history.detail.get -> history.snapshot` | detail query mapped into snapshot payload |
| `ask.list` / `ask.detail.get` | ASK records and pending snapshots |
| `blackboard.list` / `blackboard.detail.get` | Blackboard detail and worker output |
| `crystal.list` | Crystal/Gem read model |
| `fork.list` / `fork.detail.get` | ContextFork records |
| `fork.memory.get` | `fork.memory.snapshot` recent ContextFork panel projection |
| `replay.list` / `replay.detail.get` | Replay records |
| `scope.list` / `scope.detail.get` | Scope records |
| `task.list` / `task.detail.get` | Task plans |
| `thought.detail.get` | Thought/detail projection |
| `execution.job.list` / `execution.job.detail.get` | Execution job snapshots |

Detail payloads 使用 `payload.data`。

`task.plan.decide` 不是 read-model query；它是用于确认、补充或放弃待确认计划的显式 control write command。

`execution.job.snapshot` 来自 `brain.db` execution-job ledger。`children[]` 携带 `childId` / `id`、`childJobId`、有限任务摘要、`status`、`toolCalls`、`limited` 和 `limitReason`；`toolExecutions[]` 携带 `childJobId`、`server`、`tool`、`key`、`ok` / `status`、有限 input/output preview、`error`、`durationMs`、`limited` 和 `limitReason`。这些字段只用于 TUI 链接 job / child / tool / model 审计，不是 prompt 容器。

历史对话列表获取使用 `history.list`；detail lookup 使用 `history.snapshot` 和上面的 detail request family。

当 `history.list.payload.contextForkId` 存在时，read model 会把 ledger replay 收窄到该显式 context fork。它仍然不会从 transport identity 推断连续性。

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

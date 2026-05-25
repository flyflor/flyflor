# Runtime Events

## 定位

`src/events` 是 event fabric。它发布可 JSON 序列化的 RuntimeEvents，fan-out 到 sinks，并让 `/ws` client 订阅 event timelines。

Events 是 observability 和 coordination signals。它们不是 prompt 容器，也不替代 ledger/query plane。

## Owner

| 路径 | 职责 |
| --- | --- |
| `src/events/runtime.event.ts` | Runtime event types 和 builders。 |
| `src/events/component.ts` | Event component 和 hook registration。 |
| `src/events/bus.ts` | Subscription/fan-out bus。 |
| `src/events/sinks.ts` | Console/null/composite sinks。 |
| `src/events/classifier.ts` | Subscription 使用的 event class mapping。 |

## Event 示例

重要 event families 包括：

- socket/gateway lifecycle：start、message received、dispatch failed
- turn lifecycle：delta/final/error visibility
- ASK lifecycle：ask created、answered、resumed
- Executive loop：`executive.loop.paused`、`executive.loop.resumed`
- tool lifecycle：calls、approvals、failures 和 summaries
- Memory/Crystal lifecycle：recall、consolidation、reflection 和 Gem evidence
- Scope recall 和 promotion events
- Blackboard detail 和 worker progress

## Event Matrix

| Event area | Authority |
| --- | --- |
| Current turn final state | 当前轮权威状态仍读 `turn.final.reply.metadata`。 |
| Planning snapshots | 结构化快照仍读 `turn.final.reply.metadata.planning`。 |
| Runtime timeline | `RuntimeEvent` 默认是时间线事实流。 |
| Historical/detail inspection | 读取 `src/socket/query` snapshots 和 ledger/detail rows。 |

## Socket Subscription

`event.subscribe` 通过 `/ws` 暴露 RuntimeEvents。Subscription filters 使用 protocol 中的 event classes 和 event type names。实时 consumer 应订阅 events；历史 consumer 应查询 `src/socket/query` read models。

## 边界

Event payloads 必须可 JSON 序列化。它们不能携带 socket、stream、function 或 class instance。

Events 可以包含 ids 和 provenance。它们不应包含 provider secrets、private tokens 或 event contract 明确暴露之外的 raw prompt context。

## 测试

相关覆盖：

- `tests/event.component.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.ws.test.ts`

# Flyflor Socket OpenAPI

`flyflor.socket.openapi.json` 是给 Apifox 导入使用的真实场景测试契约。连接 `/ws` 后，把 components examples 里的 `value` 当作原始 WebSocket JSON body 发送。

注意：

- 当前真实 transport 是 `/ws` WebSocket，HTTP 只保留 `/health` 和 `/ws` upgrade。
- `gateway.*` 是 `flyflor.ws.v1` 的 v1 兼容 wire 名称，不代表架构主语仍是 Gateway。
- `history.list` 只查询 `brain.db` 生命账本，用于 ledger/query/replay/audit，不做 session restore，不是 prompt 容器，也不参与 context assembly。
- `clientId`、`conversationKey`、`threadId`、`user.id` 只用于 live peer、routing、audit、dedup、reply anchor，不承担也不创建认知连续性。
- 真正上下文装配来自当前输入、`MemoryComponent`、`CrystalComponent`、显式 `Scope/Fork` 和 Executive 可见能力面。

## Apifox 流程

1. 导入 `docs/openapi/flyflor.socket.openapi.json`。
2. 启动 Flyflor socket 服务。
3. 请求 `GET /health`，预期 `HealthOk`。
4. 用 Apifox WebSocket 连接 `ws://127.0.0.1:8788/ws`。
5. upgrade 后先观察 `ServerHello`。
6. 发送 `ClientHello`，预期 `Ack`。
7. 发送 `GatewayStatusGet`，预期 `GatewayStatusSnapshot`。
8. 发送 `CapabilityCatalogGet`，预期 `CapabilityCatalogSnapshot`。
9. 发送 `HistoryList`，预期 `HistorySnapshot`。
10. 发送 `GatewayMessageSend`，观察一个或多个 `TurnDelta`，最后收到 `TurnFinal`。

Apifox 导入提示：OpenAPI 文件会把 `/ws` 表达成 upgrade endpoint，但场景消息放在 `components.examples` 下。做 WebSocket 测试时，复制每个 example 的 `value` 作为 outgoing JSON body，保留其中的 `protocol`、`type` 和 request id。

## Metadata 场景

这些 examples 可以直接作为 Apifox WebSocket 消息复用：

- `TurnFinalWithAsk` 展示 `turn.final.reply.metadata.ask`。
- `TurnFinalWithPlanning` 展示带 task plan、fork、replay snapshot 的 `turn.final.reply.metadata.planning`。
- `TurnFinalWithExecutiveLoopPause` 同时展示 `reply.metadata.executiveToolLoop` 和 `reply.metadata.ask.executiveToolLoop`。
- `EventSubscribe`、`ExecutiveLoopPausedEvent`、`ExecutiveLoopResumedEvent` 展示生命周期事件时间线。当前轮权威状态仍以 `turn.final.reply.metadata` 为准。
- `InvalidGatewayMessageSend` 接 `InvalidPayloadError` 覆盖缺少 `payload.text` 时的结构化 `invalid-payload` 响应。

## 边界检查

- `GatewayMessageSend.payload.context.activeScope` 和 `contextForkId` 是 socket message 中唯一的显式工作域输入。
- `activeProject` 只是 `activeScope` 的兼容别名；新的 Apifox example 优先使用 `activeScope`。
- `HistorySnapshot` 可以携带 reply metadata、task plan、replay 和 context fork snapshot，但这些只是 ledger replay 数据，不要回填成 prompt context。
- `conversationKey`、`threadId`、`user.id` 适合用于 Apifox 关联和路由断言，但它们不是 memory owner。

## Drift Guards

OpenAPI contract 只是 `src/protocol/control` 的文档描述，不创造 runtime truth。修改时必须对齐：

- `tests/docs.references.test.ts`
- `tests/protocol.control.test.ts`
- `tests/gateway.ws.test.ts`

不要新增 wire v2，不要改名 `gateway.*` 兼容字符串，不要恢复 `/channels`。

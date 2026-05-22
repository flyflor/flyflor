# Flyflor Socket OpenAPI

`flyflor.socket.openapi.json` 是给 Apifox 导入使用的真实场景测试契约。

注意：

- 当前真实 transport 是 `/ws` WebSocket，HTTP 只保留 `/health` 和 `/ws` upgrade。
- `gateway.*` 是 `flyflor.ws.v1` 的兼容 wire 名称，不代表架构主语仍是 Gateway。
- `history.list` 只查询 `brain.db` 生命账本，用于 ledger/query/replay/audit，不做 session restore，也不参与 prompt/context assembly。
- `clientId`、`conversationKey`、`threadId`、`user.id` 只用于 live peer、routing、audit、dedup、reply anchor，不承担认知连续性。
- 真正上下文装配来自当前输入、`MemoryComponent`、`CrystalComponent`、显式 `Scope/Fork` 和 Executive 可见能力面。

Apifox 使用方式：

1. 导入 `docs/openapi/flyflor.socket.openapi.json`。
2. 启动 Flyflor socket 服务。
3. 先请求 `GET /health`。
4. 用 Apifox WebSocket 连接 `ws://127.0.0.1:8788/ws`。
5. 按 examples 发送 `client.hello`、`gateway.status.get`、`capability.catalog.get`、`history.list`、`gateway.message.send`，观察 `server.hello`、`ack`、`history.snapshot`、`turn.delta`、`turn.final`、`event.publish`。

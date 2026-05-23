# Apifox WebSocket 联调说明

Flyflor 真实服务面只有：

- `GET http://127.0.0.1:8788/health`
- `ws://127.0.0.1:8788/ws`

本目录不再提供任何辅助 HTTP 发送接口。Apifox 联调时必须新建真实 WebSocket 请求，URL 填 `ws://127.0.0.1:8788/ws`，然后发送 raw JSON frame。

## 文件说明

- [flyflor.socket.apifox.openapi.json](flyflor.socket.apifox.openapi.json)：可导入 Apifox 的真实入口契约，只包含 `/health` 和 `/ws`。
- [flyflor.socket.messages.json](flyflor.socket.messages.json)：前端和 Apifox 共用的 WebSocket 消息目录，包含每个 frame 的 `value`、`schema`、方向和预期响应。
- [flyflor.socket.tester.html](flyflor.socket.tester.html)：可直接用浏览器打开的真实 WebSocket 测试页，内嵌同一份消息目录。

Apifox 的 JSON Schema 校验参考 [JSON Schema 文档](https://apifox.pkfare.com/help/reference/json-schema/)。生成器会为每个 frame 生成独立 JSON Schema：`protocol` 和 `type` 使用 `enum` 固定，`at` 使用 `date-time`，payload 按示例结构生成 `required`、`properties` 和数组 item schema。

## 真实测试步骤

1. 启动内核：

```bash
bun run socket
```

2. 在 Apifox 新建 WebSocket 接口：

```text
ws://127.0.0.1:8788/ws
```

3. 连接后先观察服务端推送的 `ServerHello`，它的 wire type 是 `server.hello`。

4. 打开 [flyflor.socket.messages.json](flyflor.socket.messages.json)，找到 `direction` 为 `client->server` 的消息，把对应 `value` 原样复制到 Apifox WebSocket message editor 发送。

5. 对话输入使用 `GatewayMessageSend`，它会触发真实 turn，正常情况下会收到 `TurnDelta` 和 `TurnFinal`。默认 `GatewayMessageSend` 示例不带 `payload.context`，适合第一条直接联调；只有当前端已经从 Scope 创建、列表或详情拿到真实可写路径时，才在 `payload.context.activeScope` 中带 `projectDir` 和 `projectMemoryDir`。

6. 不想用 Apifox 时，直接用浏览器打开 [flyflor.socket.tester.html](flyflor.socket.tester.html)，连接后选择示例并发送；这个页面走的也是同一个 `ws://127.0.0.1:8788/ws`。

## 覆盖面

集合覆盖：

- handshake：`server.hello`、`client.hello`、`ack`、`ping`、`pong`
- control：`gateway.status.get`、`capability.catalog.get`
- live turn：`gateway.message.send`、`turn.delta`、`turn.final`、ASK、planning、Executive loop pause、invalid payload
- TUI read queries：history、scope、fork、ask、blackboard、task、replay、thought、crystal 的 list/detail 查询
- TUI snapshots：对话记录、深度思考、黑板、ASK、fork、scope 记忆树/热区/关联词、task、replay、crystal gems
- event stream：`event.subscribe`、`event.unsubscribe`、`event.publish`、Executive loop paused/resumed event

## 更新方式

不要手写修改生成 JSON。更新 canonical OpenAPI examples 或补充 Apifox-only 示例后运行：

```bash
bun run docs:apifox
bun run docs:check
```

`bun run docs:check` 会执行 `docs:apifox:check`，确保本目录产物没有漂移。

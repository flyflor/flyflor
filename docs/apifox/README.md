# Apifox WS 示例集合

`docs/openapi/flyflor.socket.openapi.json` 是真实服务契约，只暴露 `GET /health` 和 WebSocket `/ws`。Apifox 左侧路径树通常只展示 HTTP path，所以 WebSocket frame examples 不会像普通接口一样全部展开。

本目录提供两份 Apifox 专用测试产物：

- [flyflor.socket.apifox.json](flyflor.socket.apifox.json)：Apifox project-style WebSocket 示例集合。每个条目都带 `{{ws_origin}}/ws`、raw JSON body、方向和期望返回示例。
- [flyflor.socket.apifox.openapi.json](flyflor.socket.apifox.openapi.json)：Apifox 展开视图。它保留真实 `/health`、`/ws`，并额外生成 `/__apifox/ws/...` doc-only 伪操作，让 Apifox 路径树能直接点开每个 WS frame 示例。

这些 `/__apifox/ws/...` 路径不是 Flyflor 服务端接口，不允许在实现中新增对应 HTTP 路由。真实测试方式始终是连接 `ws://127.0.0.1:8788/ws`，然后发送集合里的 raw JSON WebSocket body。

Apifox 的 schema 校验参考 [JSON Schema 文档](https://apifox.pkfare.com/help/reference/json-schema/)。生成器会为每个 frame 生成独立 JSON Schema：`protocol` 和 `type` 使用 `enum` 固定，`at` 使用 `date-time`，payload 按示例结构生成 `required`、`properties` 和数组 item schema。

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
